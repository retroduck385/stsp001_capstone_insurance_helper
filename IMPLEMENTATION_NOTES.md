# InsureCopilot — Implementation Notes

**Branch:** `cleaned-code-structure` · **Last updated:** 11 August 2026

A record of two pieces of work: reorganising the frontend, and connecting document
uploads to MongoDB. Written so that anyone on the team — or you in three weeks — can
pick it up without rereading the code.

Companion documents:

| Document | What it covers |
|---|---|
| [`frontend/STRUCTURE.md`](frontend/STRUCTURE.md) | Where every React component lives and what it does |
| [`backend/BACKEND_GUIDE.md`](backend/BACKEND_GUIDE.md) | How the API, Mongoose and Atlas work, with troubleshooting |
| **This file** | What changed, why, and what to do next |

---

## 1. Where the project started

Two separate problems.

**The frontend was one 988-line file.** `App.jsx` held the navbar, dashboard, claim
workspace and all five modals. It was also **broken**: a previous rewrite had copied the
JSX but dropped the entire handler block, leaving thirteen identifiers referenced but
never defined (`filteredClaims`, `openClaimDetail`, `handleDocumentUpload`,
`handleDirectApprove`, and ten more). The dashboard threw `ReferenceError` on first
render.

**Nothing was saved.** The backend had exactly two endpoints, both `GET`. Uploading a
file called `URL.createObjectURL()`, which makes a `blob:` URL that exists only in
browser memory. The file never left the page; a refresh erased it. This wasn't a broken
save — there was no save path at all.

---

## 2. Decisions we made, and why

These were choices with real trade-offs. Recording them so nobody has to re-litigate.

| Decision | Chosen | Reasoning |
|---|---|---|
| How components share state | **Props from `App.jsx`** | Easier to follow than Context for a team learning React. `App.jsx` is the only stateful component; everything else is presentational. Can move to Context later if prop lists get painful. |
| Old files (`App_old.jsx`, `AppView.jsx`) | **Deleted** | Orphaned and confusing. Recoverable from git history. |
| Where uploaded file bytes live | **Server disk** (`backend/uploads/`), metadata in MongoDB | Standard approach. Files survive restarts, and the Python OCR can later read them straight off disk by path. Rejected: base64 in the document (MongoDB caps documents at 16 MB — two photos would break a claim permanently) and GridFS (more machinery than this needs right now). |
| Which database | **MongoDB Atlas**, the team's shared `stsp_db` | Already set up for the team. No local MongoDB install needed. |
| Seeding sample claims | **Did not run it** | The cluster already had three claims covering all three claim types, so the capstone's "three sample claims" requirement was already satisfied. The script exists for a fresh database. |
| The `ocrData` shape mismatch | **Built a full adapter** | Initially we planned to skip this. Inspecting the real data showed `ocrData` is a nested object while the whole UI expected an array — this would have crashed the app right after an upload. Building the translation layer unlocked 78–82 OCR fields per claim that the UI previously couldn't reach. |
| Test upload to the shared cluster | **Done, and left in place** | Gives a real stored document to look at in Compass and in the UI. |

---

## 3. What changed

### 3.1 Frontend restructure *(already committed — `e37bb2c`)*

`App.jsx` was split into 17 focused files matching the agreed folder layout, and the
thirteen missing handlers were restored from `App_old.jsx`. Three bugs were fixed along
the way:

1. **Rules-of-hooks violation** — the loading/error early returns sat *above* seventeen
   more `useState` calls, so React threw "Rendered more hooks than during the previous
   render" as soon as the fetch resolved. The guards now sit below every hook.
2. **`approvedPayout` was always 0** — seeded from `activeClaim` on the first render,
   when the claims object was still empty. Now set from the API response.
3. **An empty database crashed the app** — `activeClaim` was `undefined` and every
   property access threw. There's now a "No claims found" guard.

### 3.2 Document uploads → MongoDB

**New — `backend/src/routes/documents.js`**

```
POST /api/claims/:claimId/documents            upload a new document
PUT  /api/claims/:claimId/documents/:docId     replace an existing one
```

Both accept `multipart/form-data` with a `file` part and a `documentType` text field (the
claim requirement the file belongs to), and both respond with the **complete updated
claim** so the frontend can swap its copy rather than guess at a merge.

Also handles: 15 MB size limit, file-type filtering, deleting the old file on replace, and
removing the uploaded file if the database write fails so no orphans accumulate.

**New — `frontend/src/services/api.js`** — every backend call in one place, plus the
file-URL rewriting described in §5.

**Changed — `frontend/src/App.jsx`** — `handleDocumentUpload` is now async and POSTs a
`FormData`. Nothing is added optimistically: on success the server's version of the claim
replaces the local one, so the screen always matches the database. On failure you get an
error in the activity feed and no phantom document.

**Changed — `backend/src/server.js`** — three lines only (mount the two routers, serve
`/uploads`). Kept deliberately small because the backend developer is actively editing
the schema in that file; a large diff would mean merge conflicts for them.

### 3.3 The `ocrData` adapter

The backend stores OCR results as a nested object keyed by document type. The UI expects
a flat array where each entry knows which document it came from.

```
DATABASE                                  UI
ocrData: {                                ocrData: [
  motorClaimForm: {                         { fieldId: 'assured_full_name',
    assured_full_name: "Juan Dela Cruz",      label: 'Full Name of Assured…',
    ...53 fields                             extractedValue: 'Juan Dela Cruz',
  },                          ⇄              sourceDoc: 'doc-1786439305569',
  driversLicense: { ...11 },                 section: 'motorClaimForm' },
  ...16 sections                           ...78 entries
}                                         ]
```

**New — `frontend/src/data/ocrSchema.js`** — all 16 sections, every field, human-readable
labels, and the keywords that decide which uploaded document each section belongs to.

**New — `frontend/src/services/ocrAdapter.js`** — the conversion, both directions.

**New — `backend/src/routes/ocr.js`** — `PATCH /api/claims/:claimId/ocr` so corrections
actually persist. Previously the form and licence editors wrote to a local
`claimFormFields` key that went nowhere.

**Two bugs found while building this:**

- **The form editor would have wiped data.** It submits all 57 of its fields on every
  save, most as empty strings. Saving one edit would have blanked every field the editor
  hadn't displayed. `buildOcrPatch()` now diffs against current values and sends only
  genuine changes.
- **Section-replacing updates destroy siblings.** Writing
  `{$set: {"ocrData.driversLicense": {...}}}` replaces the entire section. The endpoint
  builds per-field dot paths instead (`ocrData.driversLicense.driver_license_name`).

### 3.4 Supporting scripts and config

| File | Purpose |
|---|---|
| `backend/scripts/inspectDb.js` | **Read-only.** Prints what's in the database — claims, their shapes, whether `ocrData` is an array or object. Run it any time you're unsure what you're connected to. `npm run inspect` |
| `backend/scripts/seedClaims.js` | Adds three sample claims, one per claim type. Strictly additive — never deletes or overwrites, safe to re-run. Not needed on the current cluster. `npm run seed` |
| `backend/.env` | Your connection string. **Gitignored — never commit it.** |
| `backend/.env.example` | Template. Corrected: the port was wrong (5000 → 5001), and it now explains the two things Atlas's copy-paste string gets wrong. |
| `.gitignore` | Added `backend/uploads/` and `frontend/dist/` |

---

## 4. Running it

```bash
# Terminal 1 — the API
cd backend
npm install
npm run dev          # must print "Connected to MongoDB"

# Terminal 2 — the UI
cd frontend
npm install
npm run dev          # http://localhost:5173
```

> **The server starts even when the database connection fails** — it only logs a warning.
> "The server started" proves nothing. Look for **`Connected to MongoDB`**. Without it,
> `/api/claims` hangs for ten seconds and returns "buffering timed out", which always
> means "no database connection".

**Setting up `backend/.env`** — copy `.env.example` and fill in a database user's
credentials from Atlas → Database & Network Access. Two things trip everyone up:

1. Your Atlas *login* is not a *database user*. They're separate accounts.
2. The connection string Atlas gives you **omits the database name**. It goes between the
   `/` and the `?`. Leave it out and Mongoose silently connects to a default database
   called `test` instead of `stsp_db`.

---

## 5. Things worth understanding

Four non-obvious mechanics. Each caused, or would have caused, a real bug.

### The `Mixed` trap

`documents` is declared `[mongoose.Schema.Types.Mixed]`. Mongoose tracks which fields
changed so it can save only those — but **it cannot detect changes inside a `Mixed`
field**:

```js
claim.documents.push(newDoc);
await claim.save();          // ← saves NOTHING. No error.
```

The fix is to tell MongoDB what to do directly rather than mutating and saving. If you
ever think "I saved it but the database didn't change", this is almost certainly why.
Explained fully in [`BACKEND_GUIDE.md` §5](backend/BACKEND_GUIDE.md).

### Never set `Content-Type` on a `FormData` request

The browser must set it itself, because it has to include a generated boundary marker
(`multipart/form-data; boundary=----WebKitFormBoundary...`). Set it by hand and the
boundary is missing, so the server can't split the request apart — you get a confusing
"no file received" error even though you clearly sent one.

### Why file URLs get rewritten

The database stores `fileUrl` as `/uploads/scan.pdf` — relative, so it stays correct if
the API ever moves to a real domain. But the React app is served on port **5173**, so a
relative URL resolves to `localhost:5173/uploads/scan.pdf` and 404s.
`normaliseClaim()` in `services/api.js` rewrites them to absolute URLs the moment data
arrives, in one place, so no component has to think about it.

### `extractedValue` is for display; `rawValue` is the real thing

Each item the adapter produces carries the same value twice, and mixing them up causes
real bugs:

| Property | Type | Use it for |
|---|---|---|
| `extractedValue` | **always a primitive** | rendering on screen. Never save it. |
| `rawValue` | the original (array / number / string) | editors, and anything you save |
| `isTable` | boolean | fields holding rows rather than one value |

Some OCR fields are arrays — `description_of_damage`, `affected_persons`,
`detectedParts`, `receiptNumbers`. **React cannot render an array of objects**: it throws
*"Objects are not valid as a React child"* and unmounts the whole tree, leaving a blank
white page with no message.

This actually happened. `description_of_damage` on `CLM-2026-9001` is
`[{"part":"Front Bumper","extent":"Dented"}]`, and the adapter originally passed it
straight through to JSX. `displayValue()` in `services/ocrAdapter.js` now turns arrays
into readable text (`"1 row(s): Front Bumper"`) while `rawValue` keeps the array intact
for the form editor's row table.

Two consequences worth remembering:

- The form editor reads `rawValue` for its tables and excludes table fields from its
  scalar payload, so a display summary can never be saved over a real array.
- `DocumentPreview` hides "✏️ Edit OCR" for table fields, because the correction modal is
  a one-line text box and saving through it would replace the array with a string.

### There is an error boundary — read it when things break

`components/ErrorBoundary.jsx` wraps the app in `main.jsx`. If a render error happens, you
get the error message and component stack **on the page** instead of a blank screen. The
crash above cost far more time than it should have precisely because there was no
boundary — the page just went white.

### How OCR fields find their document

An OCR section links to a document by matching keywords against that document's
`documentType` — the requirement it was uploaded against. So **OCR fields only appear
once the matching document is uploaded.** On `CLM-2026-9001` right now, 53 fields are
linked to the uploaded claim form and 25 are still waiting for their documents (11
driver's licence, 5 registration, 3 police report, 4 repair estimate, 2 damage pictures).

That's by design, but it does mean an empty editor usually means "that document hasn't
been uploaded yet", not "the adapter is broken".

---

## 6. Verification

Everything was tested against a **real MongoDB** (an in-memory instance for the automated
runs), not mocks — including re-reading from the database to prove writes actually
landed rather than trusting the API response.

| Suite | Checks | Covers |
|---|---|---|
| Component rendering | 16 | Every extracted component across all three claim statuses, empty documents, no OCR data, all five modals |
| Upload / replace API | 39 | Persistence, `docsCount` repair, replace semantics, old-file deletion, orphan cleanup, 404/413/415 |
| `ocrData` adapter | 49 | Section mapping, flattening, dates, numbers, tables, malformed input, the changed-fields-only filter, and the guard that no unrenderable value escapes |
| OCR PATCH endpoint | 19 | Field-level updates, sibling preservation, multi-section patches, error handling |
| Component rendering with **live** data | 11 | `DocumentPreview`, both editors and the full workspace rendered with the real claim from Atlas — including the form editor open |

The last suite exists because of a bug that got through: the earlier tests confirmed the
data reaching the browser was correct, but never rendered it. The value was right; it just
wasn't renderable. Rendering the real components against real data is what catches that
class of problem.

**Live verification against the team's Atlas cluster:**

| Check | Result |
|---|---|
| Upload | `HTTP 201` |
| File on disk | `backend/uploads/1786439305567-motor_claim_form.pdf` |
| Served over HTTP | `200`, `application/pdf` |
| Present in Atlas | confirmed by an independent re-read |
| `docsCount` | **6 → 1** — the stale count self-repaired |
| OCR fields linked | **53 of 78** attached to the uploaded document |

**Not verified:** the browser UI itself. The API and data layers are proven; rendering
has not been visually confirmed.

---

## 7. Known gaps and next steps

### Needs a decision from the backend developer

**OCR corrections overwrite the AI's original reading.** The schema stores one value per
field:

```js
driversLicense: { driver_license_name: { type: String, default: null } }
```

When an adjuster corrects `"Jan Dela Cruz"` to `"Juan Dela Cruz"`, the original is gone.
There's nowhere to record what the AI read, who changed it, or when — so after a refresh
it looks as though the AI got it right first time.

The project brief asks that AI recommendations be *"auditable alongside the adjuster's
edits"*. **That is not currently achievable.** The fix is a schema change:

```js
driver_license_name: {
  value:       { type: String, default: null },  // current, adjuster-corrected
  aiValue:     { type: String, default: null },  // what the OCR originally read
  confidence:  { type: Number, default: null },
  correctedBy: { type: String, default: null },
  correctedAt: { type: Date,   default: null }
}
```

Only `flattenOcrData()` in `services/ocrAdapter.js` would need updating to match — the
components consume its output and wouldn't change.

Same root cause: **there are no confidence scores**, so every field shows "Not provided"
and the "⚠️ Low Confidence" highlighting never triggers.

**Claims have no `createdAt`.** `GET /api/claims` sorts by it, so ordering is currently
arbitrary. New claims created through Mongoose will get it automatically; the three
existing ones were inserted without it.

### Not yet persisted

Only **document uploads and OCR corrections** reach the database. These are still React
state only and lost on refresh, because no endpoints exist for them:

- approve / deny decisions
- payout overrides and adjuster comments
- the requirements checklist
- the activity feed
- rules re-evaluation results

Adding them follows the same pattern as `routes/ocr.js` — a `PATCH` endpoint plus a
function in `services/api.js`.

### The OCR pipeline is still disconnected

This is the biggest remaining piece, and the natural next one.

The Python scripts at the repo root (`gemini_ocr.py`, `policy_loader.py`) run standalone
and print to the terminal. Nothing carries their output into MongoDB, and
`backend/scripts/gemini_ocr.py` is an empty placeholder. `gemini_ocr.py` also hardcodes
its input file, so it can't accept an arbitrary upload.

The groundwork is now in place: uploaded files sit on disk at a known path, recorded in
`documents[].storedFileName`. A pipeline would be:

```
upload → file on disk → OCR reads it → JSON out → PATCH /api/claims/:id/ocr
```

The prompts in `gemini_ocr.py` already produce keys matching the `ocrData` schema exactly,
so the output should slot in with little translation. Note also that the Python side uses
a different environment variable name (`MONGODB_URI`) from the Node side (`MONGO_URI`) —
worth reconciling.

### Smaller items

- **Files are local, the database is shared.** `backend/uploads/` is on one machine, so
  teammates see a document listed and get a 404 for the file. Inherent to disk storage;
  the fix when it matters is GridFS or S3, and the endpoint wouldn't change shape.
- **The API URL is hardcoded** to `http://localhost:5001` — at least it's in one place
  now (`services/api.js`). A Vite proxy or `VITE_API_URL` would be tidier.
- **No authentication.** Anything that can reach port 5001 can write to the claims
  collection. Fine for a course project; would matter for anything real.
- **Requirement matching is filename-based.** `documentMatchesRequirement()` matches on
  title/filename text, so a file called `IMG_2841.jpg` won't attach to its requirement
  even when `documentType` is set correctly. Matching on `documentType` first would be
  more reliable.
- **KPI tiles are hardcoded** ("4 Claims" / "3 Claims" / "1 Claim") rather than derived.
- **Tailwind loads from a CDN** rather than being built.

---

## 8. Quick reference — where do I go to change X?

| I want to change… | File |
|---|---|
| The API address | `frontend/src/services/api.js` (`API_BASE`) |
| Which claims appear under each dashboard tab | `frontend/src/App.jsx` (`filteredClaims`) |
| Required documents for a claim type | `frontend/src/data/claimRequirements.js` |
| Which OCR fields exist, or their labels | `frontend/src/data/ocrSchema.js` |
| How a document links to its OCR section | `frontend/src/data/ocrSchema.js` (`documentKeywords`) |
| What happens on upload | `frontend/src/App.jsx` (`handleDocumentUpload`) → `backend/src/routes/documents.js` |
| Upload size limit or allowed file types | `backend/src/routes/documents.js` (`MAX_FILE_BYTES`, `ALLOWED_MIME_TYPES`) |
| How a document is previewed | `frontend/src/components/claims/DocumentPreview.jsx` |
| The claim schema | `backend/src/server.js` — **owned by the backend developer** |
| Approve / deny / payout buttons | `frontend/src/components/claims/DecisionPanel.jsx` |

Full component map in [`frontend/STRUCTURE.md`](frontend/STRUCTURE.md).

---

## 9. Housekeeping

- **Rotate the database password.** It was typed in plain text during development. Atlas →
  Database Access → Edit → Edit Password, then update `backend/.env`.
- `backend/.env` is gitignored. Keep it that way — share credentials with teammates
  directly, never through the repository.
- A test document (`motor claim form.pdf`) was deliberately left on `CLM-2026-9001` as a
  working example. Delete it from Compass whenever you like.
- `backend/uploads/` is gitignored, so uploaded files are never committed.
