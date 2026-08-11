# InsureCopilot Frontend — Structure Guide

How the React app is organised and where to go to change things.

---

## 1. Folder tree

```
frontend/src/
├── main.jsx                          React entry point — mounts <App /> into #root
├── index.css                         Global styles (Tailwind itself is loaded from CDN in index.html)
├── App.jsx                           ← ALL state + ALL handlers + screen switching
│
├── components/
│   ├── Navbar.jsx                    Top bar. Shows adjuster identity on the dashboard,
│   │                                 claim id / insured / back button / status pill in the workspace.
│   ├── Dashboard.jsx                 Dashboard screen shell (stats + table on the left, activity on the right)
│   ├── ClaimWorkspace.jsx            Claim detail screen shell (two 50/50 panels)
│   │
│   ├── dashboard/
│   │   ├── DashboardStats.jsx        The three KPI tiles across the top
│   │   ├── ClaimTable.jsx            Filter tabs + the claims table
│   │   └── ActivitySidebar.jsx       Right-hand "Activity & Real-Time Alerts" feed
│   │
│   ├── claims/
│   │   ├── ClaimRequirements.jsx     LEFT panel: required-documents checklist per claim type
│   │   ├── DocumentPreview.jsx       One submitted document rendered inline under its requirement
│   │   │                             (pdf / image / estimate / generic file) + its OCR fields
│   │   ├── ClaimAssessment.jsx       RIGHT panel shell + the claimed/approved/policy metric tiles
│   │   ├── OcrVerification.jsx       Dark "HITL Verification" OCR field inspector
│   │   ├── PolicyRules.jsx           Colour-coded policy rules list + master policy citation
│   │   └── DecisionPanel.jsx         Approve / Edit Payout / Deny + the email notification row
│   │
│   └── modals/
│       ├── ImageViewerModal.jsx      Full-screen image lightbox
│       ├── OcrCorrectionModal.jsx    Correct an OCR field and re-run the rules engine
│       ├── DenyClaimModal.jsx        Denial reason form
│       ├── EditPayoutModal.jsx       Payout override form
│       └── EmailModal.jsx            Policyholder decision-notice email preview
│
├── data/
│   ├── claimRequirements.js          Required documents per claim type, the keyword map used to
│   │                                 match uploaded filenames, and documentMatchesRequirement()
│   └── ocrSchema.js                  The 16 ocrData sections, their fields and labels, and which
│                                     uploaded document each section belongs to
│
└── services/
    ├── api.js                        Every call to the backend: fetchClaims, uploadDocument,
    │                                 replaceDocument, saveOcrCorrections, plus API_BASE and the
    │                                 file-URL rewriting that makes /uploads/... paths resolve
    └── ocrAdapter.js                 Converts ocrData between the backend's nested object and the
                                      flat array the UI components expect
```

---

## 2. How data flows

```
      MongoDB Atlas
         ▲  │  (backend/src/server.js — API on http://localhost:5001)
         │  ▼
   ┌──────────────┐
   │ services/    │  fetchClaims()      GET  /api/claims
   │   api.js     │  uploadDocument()   POST /api/claims/:id/documents
   │              │  replaceDocument()  PUT  /api/claims/:id/documents/:docId
   └──────┬───────┘
          ▼
   ┌───────────┐
   │  App.jsx  │  → array is keyed by claim.id into `claimsDb`
   │  ALL      │  → holds all UI state
   │  STATE    │  → owns every handler that changes that state
   └─────┬─────┘
         │ props (state values + on* callbacks)
         ▼
   Navbar · Dashboard · ClaimWorkspace · 5 modals
         │ props
         ▼
   dashboard/* · claims/* leaf components
```

Document uploads are the one flow that goes **back up** to the database. After a
successful upload the server returns the whole updated claim and `App.jsx` swaps its copy
for that — so the screen always reflects what is actually stored. See
`backend/BACKEND_GUIDE.md` for the full round trip.

**The one rule to remember: `App.jsx` is the only component with state.** Everything under
`components/` is presentational — it receives values and callbacks as props and renders. If you
need a new piece of state, add it in `App.jsx` and pass it down.

Because `ClaimWorkspace` sits deep in the tree, its props are grouped into three bundles to keep
signatures short — `requirements={{…}}`, `ocr={{…}}` and `decision={{…}}`. They are plain objects
built in `App.jsx`, not context.

---

## 3. Where do I go to change X?

| I want to change… | Go to |
|---|---|
| The API URL the app fetches from | `App.jsx`, section 3 (`THE NETWORK BRIDGE`) |
| Which claims show under each dashboard tab | `App.jsx`, section 5 (`filteredClaims`) |
| The dashboard tab names | `ClaimTable.jsx` (`TABS` const at the top) — also update `filteredClaims` |
| The KPI numbers at the top of the dashboard | `dashboard/DashboardStats.jsx` (currently hardcoded) |
| Columns in the claims table | `dashboard/ClaimTable.jsx` |
| The activity feed entries | `App.jsx` → `runAiAnalysis` / `handleSaveOcrCorrection` push into `activityLogs` |
| Required documents for a claim type | `data/claimRequirements.js` → `claimRequirements` |
| How an uploaded file is matched to a requirement | `data/claimRequirements.js` → `requirementKeywords` |
| What happens when a file is uploaded | `App.jsx` → `handleDocumentUpload` / `triggerFilePicker` |
| How a document is previewed (PDF, image, estimate…) | `claims/DocumentPreview.jsx` |
| The OCR field list in the right panel | `claims/OcrVerification.jsx` |
| What an OCR correction does to the rules/payout | `App.jsx` → `handleSaveOcrCorrection` |
| Rule colours / icons | `claims/PolicyRules.jsx` |
| Approve / Deny / Edit Payout buttons | `claims/DecisionPanel.jsx` (UI) + `App.jsx` handlers (behaviour) |
| The email text sent to policyholders | `modals/EmailModal.jsx` |
| Adjuster name shown in the UI | `components/Navbar.jsx` and `dashboard/ActivitySidebar.jsx` (hardcoded in both) |

---

## 4. What changed in this restructure, and why

### The monolith was split
`App.jsx` was a single 988-line file containing the navbar, dashboard, workspace and all five
modals. It is now ~400 lines of state and handlers, and 17 focused component files.

### Broken code was restored
`App.jsx` did not run. When it was previously rewritten, the JSX was copied over but the entire
handler block was dropped, leaving **13 identifiers referenced in the JSX but defined nowhere**
(`filteredClaims`, `openClaimDetail`, `handleDocumentUpload`, `openOcrModal`, `handleDirectApprove`,
`handleConfirmDenial`, `handleSaveOcrCorrection`, `handleSaveAndApproveEdit`, `triggerFilePicker`,
`handleSelectField`, `isChecklistChecked`, `handleChecklistToggle`, `documentMatchesRequirement`).
The dashboard threw `ReferenceError: filteredClaims is not defined` on first render. All of these
were recovered from the old `App_old.jsx` and are back in `App.jsx`, grouped by purpose.

### Three bugs fixed
1. **Rules-of-hooks violation.** The `isLoading` / `error` early returns sat *above* 17 more
   `useState`/`useRef` calls, so the first render ran 5 hooks and later renders ran 22 — React
   throws "Rendered more hooks than during the previous render." The guards now sit below every
   hook (see the comment at section 4 of `App.jsx`).
2. **`approvedPayout` never initialised.** It was seeded with
   `useState(activeClaim?.recommendedPayout || 0)`, which only reads on the first render — when
   `claimsDb` is still empty, so it was always `0`. It now starts at `0` and is set from the API
   response inside the fetch effect.
3. **Empty database crashed the app.** With no claims in Mongo, `activeClaim` was `undefined` and
   every `activeClaim.x` access threw. There is now a "No claims found in the database." guard.

### Files deleted
| File | Why |
|---|---|
| `src/App_old.jsx` | 1288-line orphan, imported by nothing. Its handlers now live in `App.jsx`; the file is still in git history if you need to diff. |
| `src/AppView.jsx` | 0 bytes, imported by nothing. |
| `src/claimRequirements.js` | Moved to `src/data/claimRequirements.js`. |
| `mongodb` in `package.json` | The Node MongoDB driver cannot run in a browser bundle and no file imported it. The frontend talks to Mongo through the Express API, never directly. |

Also dropped: `handleRemoveDocument`, a handler in the old file that no button was ever wired to.
It is recoverable from git history if a "remove document" button is added later.

### Behaviour intentionally unchanged
All JSX, Tailwind classes and interactions were moved verbatim. The UI should look and behave
identically to the previous version — apart from now actually running.

---

## 5. Known gaps (deliberately left alone)

These are **not** oversights — they were out of scope for a pure restructure and are the natural
next steps.

- **The API URL is hardcoded** to `http://localhost:5001` in `services/api.js`. It is at least in
  one place now, but there is still no Vite proxy and no `VITE_API_URL` env var, so this breaks in
  any deployed environment.
- **Everything except document uploads is still unpersisted.** Approve, deny, payout overrides,
  checklist ticks and OCR corrections mutate React state only and are lost on refresh — there are
  no endpoints for them yet. **Document uploads and replacements do persist** to MongoDB.
- **Uploaded files live on the server's disk** (`backend/uploads/`), not in the database. Since the
  Atlas database is shared with the team but that folder is not, teammates will see a document
  listed and get a 404 for the file itself. See `backend/BACKEND_GUIDE.md` §1.
- **OCR corrections lose the AI's original reading.** The schema stores one value per field, so
  a correction overwrites what the AI extracted — the `extracted → corrected` distinction only
  survives within a session. Also means no confidence scores. Needs a backend schema change; see
  `backend/BACKEND_GUIDE.md` §9 for the suggested shape.
- **The "AI analysis" is fake** — a 650 ms `setTimeout` in `runAiAnalysis`. Real OCR lives in the
  unconnected Python scripts (`gemini_ocr.py`, `policy_loader.py`); `backend/scripts/gemini_ocr.py`
  is an empty placeholder.
- **KPI tiles are hardcoded** ("4 Claims" / "3 Claims" / "1 Claim") rather than derived from `claimsDb`.
- **Adjuster identity is hardcoded** ("Ethan Jackson") in `Navbar.jsx` and `ActivitySidebar.jsx`.
- **`activeDocId` is write-only.** The "View" button on a document preview sets it, but no component
  reads it yet — it is scaffolding for a future scroll/highlight behaviour.
- **Tailwind loads from a CDN** in `index.html` rather than being built — fine for a prototype, not
  for production.

---

## 6. Running it

```bash
# Terminal 1 — API. Needs backend/.env with a MongoDB Atlas MONGO_URI.
# See backend/BACKEND_GUIDE.md for how to get the connection string.
cd backend
npm install
npm run seed         # first time only: adds three sample claims
npm run dev          # http://localhost:5001

# Terminal 2 — UI
cd frontend
npm install
npm run dev          # http://localhost:5173
```

`npm run build` in `frontend/` is a fast way to check that every import still resolves after moving
files around.
