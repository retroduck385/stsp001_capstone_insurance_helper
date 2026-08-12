# Testing guide — document filing, replace/delete, licence fields, dashboard status

What changed, and how to check each fix actually works. Written for the group;
follow it top to bottom the first time.

---

## Part 0 — Setup (do this once, it is not optional)

Three things on this machine will stop the AI extraction dead. Fix them before
testing anything OCR-related.

### 0.1 Install the Python dependencies

They are **not installed** right now — `google-genai` and `python-dotenv` are both
missing, and there is no virtualenv in the repo. That means the OCR has never
actually run here.

```bash
cd c:/Users/user/Desktop/stsp001_capstone_insurance_helper
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

> `requirements.txt` used to list `dotenv`, which is a **different package** from
> the one the scripts import. It now correctly says `python-dotenv`. If you
> installed from the old file, re-run the command above.

### 0.2 Add your Gemini API key

`backend/.env` has **no `GEMINI_API_KEY`**. Add one — get it from
<https://aistudio.google.com/apikey>:

```
GEMINI_API_KEY=your-key-here
```

### 0.3 Prove the Python side works on its own

This is the single highest-value check. If this fails, nothing else OCR-related
will work, and you will waste time blaming the app:

```bash
cd backend
python scripts/gemini_ocr.py "../driver's license test.pdf" driversLicense
```

Expected: a blob of JSON. If `python` is not found, add its full path to
`backend/.env` as `PYTHON_BIN=C:\path\to\python.exe`.

> The old code called `python3`, which on Windows is a Microsoft Store stub, not
> a real interpreter — and a missing interpreter took the whole API server down.
> It now uses `python` on Windows and fails gracefully.

### 0.4 Clean up the existing mess in MongoDB

`CLM-2026-9001` currently holds **six** documents all filed as "Driver's
License" — including a motor claim form PDF that got mis-filed there. That is
leftover damage from the old code, and it will make the fixes look broken.

```bash
cd backend
npm run cleanup:docs              # dry run — shows what it WOULD delete, changes nothing
npm run cleanup:docs -- --apply   # actually removes the duplicates
```

It keeps the newest document of each type and deletes the rest, including their
files. Read the dry-run output before applying.

### 0.5 Start the app

```bash
# Terminal 1
cd c:/Users/user/Desktop/stsp001_capstone_insurance_helper/backend
npm run dev
# must print BOTH "Connected to MongoDB" and "InsureCopilot API running on ..."

# Terminal 2
cd c:/Users/user/Desktop/stsp001_capstone_insurance_helper/frontend
npm run dev        # http://localhost:5173
```

Keep Terminal 1 visible — OCR errors print there, not in the browser.

---

## Part 1 — Documents no longer land under the wrong requirement

**The bug:** the Official Receipt requirement listed `or` as a match keyword, and
matching was a substring test that included each document's caption — which is
always "Uploaded by adjuster f**or** claim review." So *every* document on a
claim registered against that row. Worse, hitting Replace there was wired to
whichever document happened to be first in the list, so uploading a receipt
overwrote the motor claim form and deleted the original PDF.

Use a **fresh claim** for this (`CLM-2026-9002` or `CLM-2026-9004`).

- [ ] Upload `sample_application_form.pdf` from the **Completed Motor Claim Form** row.
- [ ] **The key check:** the "Official Receipt (Driver License / Vehicle OR other
      relevant OR)" row still reads **⚠ Not uploaded**. So does every other row.
- [ ] Only the Motor Claim Form row shows a preview and extracted fields.
- [ ] Upload `driver's license test.pdf` from the **Driver's License** row. It
      appears there and only there, with its own fields under it.
- [ ] Upload anything from the **Official Receipt** row. It lands there alone.
      It shows no extracted fields — correct, there is no extractor for receipts.
- [ ] Repeat on `CLM-2026-9003` (**Third-Party Bodily Injury / Death**). Its first
      requirement is labelled "Completed Motor Claim Form OR Police Report OR..."
      — that label never matched the old code's check, so **OCR never ran at all**
      on this claim type. It should now extract fields.

---

## Part 2 — Replace and Remove

**The bug:** Replace swapped the file but never re-ran the AI, so the old
document's extracted values stayed in the database while a spinner claimed it had
been re-analysed. And there was no delete endpoint at all — the only way to
un-file a document was to edit MongoDB by hand.

### Replace

- [ ] With a licence uploaded, click **↻ Replace** on that row. A dialog explains
      that your corrections are kept and blanks get filled. Confirm it.
- [ ] Pick a *different* licence file.
- [ ] The preview shows the **new** filename (it used to keep showing the old one).
- [ ] **Edit License** shows values from the new file in fields that were blank.
- [ ] Any field you had manually corrected **keeps your correction** — this is the
      behaviour that was chosen deliberately. The activity feed says how many
      fields were filled and how many were kept.
- [ ] `backend/uploads/` no longer contains the old file.

### Remove

- [ ] Click **🗑 Remove** on a document and confirm.
- [ ] It disappears, the row flips back to **＋ Upload**, and the docs count on the
      dashboard drops.
- [ ] **Edit License** now shows nothing — the extracted fields were cleared too.
- [ ] The file is gone from `backend/uploads/`.
- [ ] Upload again from that row: you get a **clean** AI re-read, with none of the
      previous document's values. (Remove-then-Upload is the "start over" path;
      Replace is the "keep my corrections" path.)

### Duplicates

- [ ] With a document already filed under a requirement, try to force a second
      upload of the same type. You should get a clear message telling you to use
      Replace or Remove — not a silent duplicate.

### It all has to survive a refresh

- [ ] **Refresh the browser** and re-check everything above. This is the real
      test that it reached MongoDB rather than just React state.
- [ ] `cd backend && npm run inspect` — one document per type, no orphans.

### Deliberately break the OCR

- [ ] Put a wrong `GEMINI_API_KEY` in `backend/.env`, restart the API, upload a file.
- [ ] **The upload must still succeed**, with an amber warning in the activity
      feed. Previously a bad key returned a 500 and deleted the file, so you
      could not upload anything at all.
- [ ] Put the correct key back and restart.

---

## Part 3 — Driver's licence Issue Date

**Decision: the field stays.** It was a *dead box* — the editor rendered it, but
the field was missing from both the database schema and the UI field registry, so
it was never filled by the AI and was silently discarded on save. It is now wired
end to end.

- [ ] Open **Edit License**. The **Issue Date** box is still there, with a note
      that many PH licences don't print one.
- [ ] If the licence shows an issue date, it is **populated from the OCR**.
      Before, it was always blank no matter what.
- [ ] If the licence has no issue date printed, it stays blank — the AI is now
      told to return nothing rather than guess. Confirm it did not invent a date
      by deriving it from the expiry date.
- [ ] Type a date, click **Save License**, then **refresh**. It is still there.
      *(This is the actual fix — the value used to be thrown away on save.)*
- [ ] `cd backend && npm run inspect` → `ocrData.driversLicense.driver_license_issue_date`
      holds what you typed.
- [ ] **Blood Type** shows a real blood type. The old field mapping matched any
      label containing the word "type", so it was capturing Blood Type by mistake.
- [ ] **Name on License** is blank or the real extracted name — never a mangled
      filename like "sample application". That filename guess was removed; a
      blank box is honest about a failed extraction.

---

## Part 4 — Dashboard and buttons

**The bug:** the KPI tiles were hardcoded to "4 / 3 / 1" and read no data at all.
There was no Status column. Approve / Deny / Edit Payout / the tickboxes were all
React state with no endpoint behind them, so a refresh reverted everything.

- [ ] The KPI tiles (now four, one per tab) match the actual row counts.
- [ ] Click each tile → it switches to the matching tab and highlights.
- [ ] The claims table has a **Status** column, colour-coded:
      blue = In Assessment, green = Completed, red = Denied.
- [ ] Click **Open Workspace →** directly on the button. It used to have no
      handler and only worked because the click leaked to the row.

### The decisions must persist — this is the main point

- [ ] Open a claim → **⚡ Approve** → back to dashboard. It moves to
      "✓ Processed & Completed" and reads Completed. **Refresh — it stays.**
- [ ] **🚫 Deny Claim** with a reason → status Denied, payout ₱0.
      **Refresh** → still denied, and the reason is still shown.
- [ ] **✏️ Edit Payout** with an override note → **refresh** → the new payout, the
      "✏️ Adjuster Modified" badge, and the note all come back.
- [ ] Tick some checklist boxes → **refresh** → still ticked.
- [ ] The tile counts move as claims change status.

### Documents

- [ ] Click **View** on a PDF → it opens in a new tab. On an image → the zoom
      lightbox opens. It previously did nothing at all.

---

## What to watch for

| Where | What it means |
|---|---|
| Browser console (F12), red errors | A blank white page means React threw. `ErrorBoundary` should show a message instead of going blank — if you get a true white screen, that is a bug worth reporting. |
| Terminal 1, `Python Error:` / `gemini_ocr.py exited with code` | The OCR script failed. Re-run step 0.3 on its own. |
| Terminal 1, `Could not start "python"` | `PYTHON_BIN` is wrong — see step 0.3. |
| Terminal 1, `CastError` / `ValidationError` | A value didn't fit the schema. Note the field name. |
| Activity feed, amber warning after upload | The file saved but the AI could not read it. Expected behaviour, not a crash. |

---

## Known gaps (not fixed, not regressions)

These were already broken and are out of scope for this pass:

- **"Send Email to Policyholder"** does not send email. It flips a flag and shows
  an alert.
- **"Analyze by AI"** and **"Accept All Suggestions"** in the motor claim form
  editor are no-ops — nothing ever produces the AI suggestions they read.
- **The "AI Analyzing…" badge** is a fixed 650 ms timer, not real progress. The
  actual extraction happens inside the upload request, before the badge appears.
- **"Policy Status: Active Coverage"** in the assessment panel is hardcoded text.
- **The adjuster name** ("Ethan Jackson") is hardcoded; there is no login.
- **OCR corrections overwrite the AI's original value.** The schema stores one
  value per field, so there is no audit trail of what the AI read versus what the
  adjuster changed it to.
