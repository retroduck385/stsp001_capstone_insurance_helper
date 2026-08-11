# InsureCopilot Backend — A Guide for the Frontend Developer

Written for someone who hasn't worked on this backend before. It explains what each
piece does, how to get it running, and how a file upload actually travels from a
button click into MongoDB.

---

## 1. The four pieces, and what each one is for

When you run the backend, four separate things are cooperating. Knowing which one is
misbehaving is most of debugging.

| Piece | What it is | Its job here |
|---|---|---|
| **Express** | A web server library for Node | Listens on port 5001 and decides which code runs for which URL |
| **Mongoose** | A "translator" between JavaScript objects and MongoDB | Defines what a claim looks like, and saves/loads them |
| **MongoDB Atlas** | MongoDB, hosted on MongoDB's servers | The actual database where claims live |
| **multer** | Express middleware for file uploads | Reads uploaded files out of the request and writes them to disk |

**Why multer is needed at all:** a normal API request sends JSON, which `express.json()`
understands. A file upload does not — it sends `multipart/form-data`, a completely
different format that can carry binary data. `express.json()` cannot read it and will
hand you an empty `req.body`. multer is the piece that parses that format. This is why
uploads didn't work before: there was no multer, so there was no way to receive a file.

### Where the files actually live

**The file bytes go on disk** (`backend/uploads/`). **Only the metadata goes in MongoDB.**

```
backend/uploads/1755012345-license.jpg     ← the actual image
                                              (on this computer)

MongoDB claims collection:
{ id: "CLM-2026-9001",
  documents: [
    { fileName: "license.jpg",
      fileUrl: "/uploads/1755012345-license.jpg",   ← just a pointer
      mimeType: "image/jpeg", size: 284113, ... }
  ] }
```

⚠️ **Consequence worth knowing:** the Atlas database is shared with your team, but
`backend/uploads/` is only on your laptop. A teammate will load the claim, see the
document listed, and get a 404 when the browser tries to display the file — because the
bytes are on *your* machine. That is inherent to storing files on disk, not a bug. If it
becomes a problem, the fix is to move the bytes into shared storage (MongoDB GridFS, or
S3/Cloudinary) — the endpoint stays the same shape, so the frontend wouldn't change.

---

## 2. Getting it running

### Step 1 — Install the dependencies

```bash
cd backend
npm install
```

### Step 2 — Get your MongoDB Atlas connection string

Atlas is MongoDB running on MongoDB's own servers. **You do not install MongoDB locally.**
A "cluster" is a database server they host for you.

What you need is a **connection string**:

```
mongodb+srv://myuser:mypassword@cluster0.ab1cd.mongodb.net/insurecopilot?retryWrites=true&w=majority
             └─ user ─┘└─password─┘└──── which cluster ────┘└─ which database ─┘
```

In Atlas: open your cluster → **Connect** → **Drivers** → **Node.js** → copy the string.

**Two things block this, and both fail confusingly:**

1. **Database Access** — your Atlas *login* is not a *database user*. They are separate
   accounts. You need a database username and password, created under **Database Access**
   in the left sidebar. Ask whoever set up the org whether one already exists.
2. **Network Access** — Atlas refuses connections from IP addresses it doesn't know.
   Under **Network Access**, add your current IP. If you skip this, the connection just
   hangs and then times out with a message that doesn't mention IP addresses at all.

### Step 3 — Create `backend/.env`

```
PORT=5001
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/insurecopilot?retryWrites=true&w=majority
```

`.env` is gitignored. **Never commit it** — it contains a password.

### Step 4 — Start it

```bash
npm run dev
```

You are looking for **both** of these lines:

```
Connected to MongoDB
InsureCopilot API running on http://localhost:5001
```

> ⚠️ **The server starts even when the database connection fails.** It only prints
> `MONGO_URI is not set.` and carries on. So "the server started" proves nothing. If you
> don't see **`Connected to MongoDB`**, requests to `/api/claims` will hang for about ten
> seconds and then fail with *"buffering timed out after 10000ms"* — that message always
> means "no database connection", never "slow query".

### Step 5 — Add sample claims

```bash
npm run seed
```

This adds three claims, one per claim type, so the dashboard has data and you can see how
the requirements checklist changes per type.

**It is deliberately non-destructive:** it never deletes or overwrites anything, and it
skips any claim id that already exists. Running it twice is safe. That matters because
you are sharing a database with your team. Even so — look at what's in the `claims`
collection before the first run.

---

## 3. The endpoints

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/health` | Is the server alive? |
| `GET` | `/api/claims` | Every claim, newest first |
| `POST` | `/api/claims/:claimId/documents` | Upload a new document |
| `PUT` | `/api/claims/:claimId/documents/:docId` | Replace an existing document |
| `PATCH` | `/api/claims/:claimId/ocr` | Save adjuster corrections to OCR fields |
| `GET` | `/uploads/<filename>` | Download/display a stored file |

Try them from the terminal — this is the fastest way to tell a backend problem from a
frontend problem:

```bash
# Is it alive?
curl http://localhost:5001/api/health

# What claims exist?
curl http://localhost:5001/api/claims

# Upload a file (the -F flag sends multipart/form-data)
curl -F "file=@C:/path/to/scan.pdf" \
     -F "documentType=Repair Estimate" \
     http://localhost:5001/api/claims/CLM-2026-9001/documents

# Correct an OCR field (this one IS JSON)
curl -X PATCH -H "Content-Type: application/json" \
     -d "{\"driversLicense\":{\"driver_license_name\":\"Juan Dela Cruz\"}}" \
     http://localhost:5001/api/claims/CLM-2026-9001/ocr
```

Both upload endpoints need exactly two things: a file part named **`file`**, and a text
field named **`documentType`** (the requirement label the file belongs to). Both respond
with the **complete updated claim**, which is why the frontend can simply swap its copy
rather than trying to merge the change itself.

**Error codes you may see:** `400` missing file or documentType · `404` no such claim or
document · `413` file over 15 MB · `415` file type not allowed.

---

## 4. The life of an upload

What happens when an adjuster clicks "Upload" on a requirement row:

```
 BROWSER
   1. triggerFilePicker() opens the file dialog        App.jsx
   2. handleDocumentUpload() builds a FormData         App.jsx
        { file: <the file>, documentType: "Repair Estimate" }
   3. uploadDocument() POSTs it                        services/api.js
        │
        ▼  multipart/form-data over HTTP
 SERVER (port 5001)
   4. Express matches POST /api/claims/:claimId/documents
   5. multer parses the body, writes the file to
      backend/uploads/1755012345-scan.pdf,
      and puts the details on req.file                 routes/documents.js
   6. buildDocumentRecord() makes the metadata object
   7. $push adds it to the claim's documents array     → MongoDB Atlas
   8. Responds 201 with the full updated claim
        │
        ▼
 BROWSER
   9. setClaimsDb() replaces that claim with the server's version
  10. DocumentPreview renders the file from
      http://localhost:5001/uploads/1755012345-scan.pdf
```

Nothing is added to the screen optimistically. If step 7 fails, no document appears in the
UI — so what you see is always what's really in the database.

### Why the file URL gets rewritten

The database stores `fileUrl` as `/uploads/scan.pdf` — a *relative* path, so it stays
correct if the API ever moves to a real domain. But the React app is served by Vite on
port **5173**, so a relative URL would resolve to `localhost:5173/uploads/scan.pdf` and
404.

`normaliseClaim()` in `services/api.js` rewrites those to absolute URLs the moment data
arrives from the API. It happens in one place, so no component has to think about it.

---

## 5. The `Mixed` trap — the one thing to be careful of

In the schema, `documents` is declared as:

```js
documents: [mongoose.Schema.Types.Mixed],
```

`Mixed` means "any shape at all, don't validate it". Convenient — but it has a sharp edge
that catches nearly everyone:

```js
// ❌ THIS SILENTLY SAVES NOTHING
const claim = await Claim.findOne({ id: claimId });
claim.documents.push(newDoc);
await claim.save();          // no error, no change in the database
```

Mongoose tracks which fields you changed so it can save only those. **It cannot detect
changes made inside a `Mixed` field** — as far as it knows, `documents` still points at
the same array, so there's nothing to save.

Two ways to do it correctly. This codebase uses the first:

```js
// ✅ Tell MongoDB what to do directly
await Claim.findOneAndUpdate(
  { id: claimId },
  { $push: { documents: newDoc }, $inc: { docsCount: 1 } },
  { new: true }              // return the doc AFTER the update
);

// ✅ Or explicitly flag the field as dirty
claim.documents.push(newDoc);
claim.markModified('documents');
await claim.save();
```

`$push` is preferred here because it's also **atomic** — two simultaneous uploads can't
overwrite each other's changes, which the read-modify-write version allows.

If you ever find yourself saying *"I saved it but the database didn't change"*, this is
almost certainly why.

---

## 6. Seeing the data with Compass

[MongoDB Compass](https://www.mongodb.com/products/compass) is a free desktop app for
browsing the database. It's optional, but genuinely worth installing while you're
learning — you can watch changes land as you make them.

Paste your `MONGO_URI` into its connection box, then open your database → the **`claims`**
collection. Expand a claim's `documents` array, upload a file in the app, hit refresh in
Compass, and watch a new entry appear. That's the clearest possible confirmation the save
worked.

---

## 7. Troubleshooting

| What you see | What it means |
|---|---|
| `MONGO_URI is not set.` | No `backend/.env`, or it's missing the line |
| `buffering timed out after 10000ms` | The database never connected — bad URI, wrong password, or your IP isn't allowlisted in Atlas Network Access |
| `Authentication failed` | Wrong database username/password. Remember: **not** your Atlas login — a Database Access user |
| Connection just hangs | Almost always Atlas **Network Access** — your IP isn't on the allowlist |
| CORS error in the browser console | The backend isn't running, or the frontend is calling the wrong port |
| `Failed to fetch` in the UI | The backend isn't running at all. Check `curl http://localhost:5001/api/health` |
| Upload returns 413 | The file is over the 15 MB limit (`MAX_FILE_BYTES` in `routes/documents.js`) |
| Upload returns 400 "No file was received" | The form field must be named exactly `file` |
| Document appears, then vanishes on refresh | The save didn't reach the database — see the `Mixed` trap above |
| Images broken for a teammate | Expected — the files are on your laptop, not in the shared database (Section 1) |

### One gotcha specific to file uploads

When sending a `FormData`, **never set the `Content-Type` header yourself.** The browser
must set it, because it has to include a generated boundary marker:

```
Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryX7Yz...
```

If you set it by hand, that boundary is missing and the server can't split the request
apart — you get a confusing "no file received" error even though you clearly sent one.

---

## 8. File map

```
backend/
├── .env                    ← you create this; gitignored; holds the Atlas password
├── .env.example            template to copy
├── package.json            dependencies and the npm scripts
├── src/
│   ├── server.js           app setup, the Claim schema, GET routes, startup
│   └── routes/
│       └── documents.js    multer config + the upload/replace endpoints
├── scripts/
│   └── seedClaims.js       adds the three sample claims (safe to re-run)
└── uploads/                uploaded files land here; gitignored
```

The `Claim` schema lives in `server.js` and is owned by the backend developer — the
upload routes were put in a separate file deliberately, to keep the two from colliding in
git.

---

## 9. Known gaps

- **No authentication.** Anything that can reach port 5001 can write to the claims
  collection. Fine locally; must not be deployed as-is.
- **Only documents persist.** Approve/deny decisions, payout overrides, OCR corrections
  and the requirements checklist are still React state only, and are lost on refresh —
  there are no endpoints for them yet.
- **⚠️ OCR corrections overwrite the AI's original reading.** This one needs a decision
  from the backend developer.

  The schema stores **one value per field**:

  ```js
  driversLicense: { driver_license_name: { type: String, default: null } }
  ```

  So when an adjuster corrects `"Jan Dela Cruz"` to `"Juan Dela Cruz"`, the original is
  gone. There is nowhere to record that the AI read it differently, who changed it, or
  when. Within a single session the UI shows `extracted → corrected`; after a refresh it
  looks as though the AI got it right first time.

  The capstone brief asks that AI recommendations be *"auditable alongside the adjuster's
  edits"* — that is not currently achievable. The fix is on the backend: store each field
  as an object rather than a bare string, e.g.

  ```js
  driver_license_name: {
    value:       { type: String, default: null },  // current, adjuster-corrected
    aiValue:     { type: String, default: null },  // what the OCR originally read
    confidence:  { type: Number, default: null },
    correctedBy: { type: String, default: null },
    correctedAt: { type: Date,   default: null }
  }
  ```

  Only `flattenOcrData()` in `frontend/src/services/ocrAdapter.js` would need updating to
  match — the components consume its output and wouldn't change.

- **No confidence scores.** The schema has no field for them, so every OCR value shows
  "Not provided" and the "⚠️ Low Confidence" highlighting never triggers. Same fix as above.
- **OCR is not connected.** The Python scripts at the repo root run standalone and print
  to the terminal; nothing carries their output into MongoDB. `backend/scripts/gemini_ocr.py`
  is an empty placeholder. Now that files are stored on disk with a known path, this is
  the natural next step.
