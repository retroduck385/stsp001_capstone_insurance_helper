// routes/documents.js
//
// File-upload endpoints for claim documents.
//
// Mounted at /api/claims by server.js, so the routes below resolve to:
//   POST   /api/claims/:claimId/documents            → upload a new document
//   PUT    /api/claims/:claimId/documents/:docId     → replace an existing document
//   DELETE /api/claims/:claimId/documents/:docId     → remove a document entirely
//
// HOW AN UPLOAD WORKS, end to end:
//   1. The browser sends a `multipart/form-data` request (a FormData object).
//      This is NOT JSON — express.json() cannot read it, which is why multer exists.
//   2. multer parses the request, writes the file into backend/uploads/, and hands
//      us the details on `req.file`. Plain text fields land on `req.body`.
//   3. We shell out to scripts/gemini_ocr.py to extract the document's fields.
//   4. We push the file's metadata into the claim's `documents` array and the
//      extracted fields into `ocrData.<section>` in MongoDB.
//   5. We respond with the whole updated claim so the frontend can just replace
//      its copy instead of trying to merge the change itself.
//
// The file BYTES live on disk (backend/uploads/). Only the metadata + a URL goes
// into MongoDB. See BACKEND_GUIDE.md for why, and what the trade-off is.

import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

import { ocrSectionForDocumentType, canRunOcrFor } from '../data/requirementSections.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// WHERE FILES ARE STORED
// ---------------------------------------------------------------------------
// __dirname doesn't exist in ES modules, so we derive it from import.meta.url.
// This resolves to <repo>/backend/uploads regardless of where npm was run from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

// ---------------------------------------------------------------------------
// MULTER CONFIGURATION
// ---------------------------------------------------------------------------
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

// Which file types the adjuster is allowed to upload. Kept in sync with the
// `accept` attribute on the file input in ClaimRequirements.jsx.
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const isAllowedFile = (file) =>
  file.mimetype.startsWith('image/') || ALLOWED_MIME_TYPES.includes(file.mimetype);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Strip anything that isn't safe in a filename, then prefix with a timestamp
    // so two adjusters uploading "scan.pdf" don't overwrite each other.
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (isAllowedFile(file)) return cb(null, true);
    // Flagging it on `req` lets the route handler return a clean 415 instead of
    // multer throwing an opaque error.
    req.rejectedFileType = file.mimetype;
    cb(null, false);
  }
});

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// The Claim model is registered in server.js. We look it up lazily, INSIDE the
// handlers, rather than at import time — this module is imported before
// server.js runs mongoose.model('Claim', ...), so grabbing it at the top level
// would throw MissingSchemaError.
const getClaimModel = () => mongoose.model('Claim');

const normaliseType = (value) => String(value || '').toLowerCase().trim();

/** The values the OCR uses to mean "nothing was read for this field". */
const isBlank = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

// Builds the object that gets stored in the claim's `documents` array.
// The property names here are what DocumentPreview.jsx already reads, so the
// frontend rendering code needs no changes.
function buildDocumentRecord(file, documentType, existingDoc = null) {
  const isPdf = file.mimetype === 'application/pdf';
  const isImage = file.mimetype.startsWith('image/');
  const publicUrl = `/uploads/${file.filename}`;

  return {
    // On replace, keep the id: the checklist and the OCR field links are keyed
    // on it, so a new id would detach the document from everything.
    id: existingDoc?.id || `doc-${Date.now()}`,
    // The title, by contrast, SHOULD follow the new file. Requirement matching
    // is done on `documentType` now, not on title text, so there is nothing to
    // break — and keeping the old title made a replace look like it hadn't
    // happened.
    title: file.originalname,
    type: isPdf ? 'pdf_document' : isImage ? 'image_card' : 'uploaded_file',
    fileUrl: publicUrl,
    fileName: file.originalname,
    storedFileName: file.filename, // needed so we can delete the file on replace
    mimeType: file.mimetype,
    size: file.size,
    imageUrl: isImage ? publicUrl : null,
    imageLabel: isImage ? file.originalname : null,
    caption: 'Uploaded by adjuster for claim review.',
    documentType,
    uploadedAt: new Date().toISOString()
  };
}

// Deletes a file from the uploads folder, ignoring "already gone" errors.
function removeStoredFile(storedFileName) {
  if (!storedFileName) return;
  fs.unlink(path.join(uploadsDir, storedFileName), (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error(`Could not delete ${storedFileName}:`, err.message);
    }
  });
}

// Validates what every upload route needs before touching the database.
// Returns an error object, or null when everything is fine.
function validateUpload(req) {
  if (req.rejectedFileType) {
    return { status: 415, message: `File type "${req.rejectedFileType}" is not allowed. Upload a PDF, image or Word document.` };
  }
  if (!req.file) {
    return { status: 400, message: 'No file was received. The form field must be named "file".' };
  }
  if (!req.body.documentType) {
    return { status: 400, message: 'documentType is required — it links the file to a claim requirement.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

/**
 * Runs scripts/gemini_ocr.py against a file and resolves with the parsed JSON.
 *
 * TWO THINGS THIS GETS RIGHT that the previous version did not:
 *
 *  1. THE INTERPRETER. It used to hardcode `python3`, which does not exist on a
 *     stock Windows install (the launcher is `python`, and `python3` is often a
 *     Microsoft Store stub that exits non-zero). Set PYTHON_BIN in backend/.env
 *     to override — e.g. a virtualenv's python.exe.
 *
 *  2. THE 'error' EVENT. If the interpreter isn't found, spawn emits 'error'
 *     rather than 'close'. With no listener attached, Node treats that as an
 *     unhandled error event and takes the whole API process down. The listener
 *     below turns it into a normal promise rejection.
 *
 * The script path is absolute, derived from __dirname, so the API no longer has
 * to be started from inside backend/ for OCR to work.
 */
function runGeminiOCR(filePath, section) {
  const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'gemini_ocr.py');

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn(pythonBin, [scriptPath, filePath, section]);

    let extractedData = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      extractedData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Interpreter missing / not executable. Without this the process would
    // crash rather than reject.
    pythonProcess.on('error', (err) => {
      reject(new Error(
        `Could not start "${pythonBin}" (${err.code || err.message}). ` +
        'Set PYTHON_BIN in backend/.env to the full path of your Python interpreter.'
      ));
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(
          `gemini_ocr.py exited with code ${code}${errorOutput ? `: ${errorOutput.trim()}` : ''}`
        ));
      }
      try {
        resolve(JSON.parse(extractedData));
      } catch {
        reject(new Error(`gemini_ocr.py did not return valid JSON. Output was: ${extractedData.slice(0, 300)}`));
      }
    });
  });
}

/**
 * Runs the OCR without ever failing the upload.
 *
 * A missing API key or a broken Python environment used to return a 500 and
 * delete the file, so the adjuster could not upload anything at all. The file
 * is the important part; the extraction can be retried with Replace.
 *
 * Resolves to { section, data, warning } — `data` is null when nothing ran.
 */
async function extractOcr(absoluteFilePath, documentType) {
  const section = ocrSectionForDocumentType(documentType);

  if (!canRunOcrFor(documentType)) {
    // Either the requirement has no ocrData section, or we have no prompt for
    // it yet. Not an error — just nothing to do.
    return { section, data: null, warning: null };
  }

  try {
    console.log(`Starting AI extraction for ${section}...`);
    const data = await runGeminiOCR(absoluteFilePath, section);
    console.log('AI extraction successful.');
    return { section, data, warning: null };
  } catch (err) {
    console.error('OCR failed (the document was still saved):', err.message);
    return { section, data: null, warning: `The file was saved, but AI extraction failed: ${err.message}` };
  }
}

/**
 * Merges a fresh extraction into whatever is already stored for that section.
 *
 * RULE: an existing non-blank value WINS. Those values may be adjuster
 * corrections typed into the Edit License / Edit Form panels, and silently
 * throwing them away on a re-upload would lose real work. Blanks are filled in
 * from the new extraction.
 *
 * To get a clean re-extract instead, DELETE the document and upload again —
 * that path clears the section first.
 *
 * Returns { merged, preserved, filled } so the API can tell the UI what it did.
 */
function mergeOcrSection(existingSection, freshData) {
  const existing = existingSection || {};
  const merged = { ...existing };
  const preserved = [];
  const filled = [];

  for (const [fieldId, freshValue] of Object.entries(freshData || {})) {
    if (!isBlank(existing[fieldId])) {
      preserved.push(fieldId);
      continue;
    }
    if (isBlank(freshValue)) continue;

    merged[fieldId] = freshValue;
    filled.push(fieldId);
  }

  return { merged, preserved, filled };
}

/**
 * Reads one ocrData section out of a claim AS A PLAIN OBJECT.
 *
 * `ocrData` is declared as a nested path (an object literal in the schema), not
 * a sub-schema, so Mongoose exposes it through getters backed by `_doc`.
 * Spreading that directly can come back empty, which would make the merge think
 * every field was blank and quietly overwrite the adjuster's corrections.
 * Going through the document's own toObject() is the only reliable route.
 */
function plainSection(claim, section) {
  if (!claim || !section) return {};
  const plainClaim = typeof claim.toObject === 'function' ? claim.toObject() : claim;
  const value = plainClaim?.ocrData?.[section];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ---------------------------------------------------------------------------
// POST /api/claims/:claimId/documents  — upload a NEW document
// ---------------------------------------------------------------------------
router.post('/:claimId/documents', upload.single('file'), async (req, res) => {
  const problem = validateUpload(req);
  if (problem) {
    if (req.file) removeStoredFile(req.file.filename); // don't leave the file behind
    return res.status(problem.status).json({ message: problem.message });
  }

  const { claimId } = req.params;
  const { documentType } = req.body;
  const Claim = getClaimModel();

  try {
    // Load the claim FIRST. Two reasons: we can 404 before spending money on a
    // Gemini call, and we can reject a duplicate before writing anything.
    const claim = await Claim.findOne({ id: claimId });
    if (!claim) {
      removeStoredFile(req.file.filename);
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    // One document per requirement. `ocrData.<section>` is a single slot on the
    // claim, so a second upload of the same type would silently overwrite the
    // first one's extraction — including any adjuster corrections.
    const duplicate = (claim.documents || []).find(
      doc => normaliseType(doc.documentType) === normaliseType(documentType)
    );
    if (duplicate) {
      removeStoredFile(req.file.filename);
      return res.status(409).json({
        message: `"${documentType}" already has a document ("${duplicate.fileName || duplicate.title}"). ` +
                 'Use Replace to swap the file, or Remove it first.'
      });
    }

    const newDoc = buildDocumentRecord(req.file, documentType);
    const absoluteFilePath = path.join(uploadsDir, req.file.filename);

    const { section, data: ocrResult, warning } = await extractOcr(absoluteFilePath, documentType);

    // WHY NOT claim.documents.push(...) + claim.save():
    // `documents` is declared as [mongoose.Schema.Types.Mixed]. Mongoose cannot
    // detect in-place changes to Mixed paths, so the push-then-save version
    // silently saves nothing. Telling MongoDB directly what to do sidesteps the
    // problem entirely (and is atomic).
    //
    // This is an aggregation-pipeline update — the array of stages below runs
    // server-side, in order. We append the document, then recompute docsCount
    // from the array's actual length rather than incrementing it. Some existing
    // claims have a docsCount that disagrees with their documents array, and
    // $inc would preserve that error forever; $size repairs it on every write.
    //
    // $literal stops MongoDB from interpreting any string in our object that
    // happens to begin with "$" as a field reference.
    const updatePipeline = [
      { $set: { documents: { $concatArrays: [{ $ifNull: ['$documents', []] }, { $literal: [newDoc] }] } } },
      { $set: { docsCount: { $size: '$documents' } } }
    ];

    // This is the first document of its type, so there is nothing to merge with.
    if (ocrResult && section) {
      updatePipeline.push({ $set: { [`ocrData.${section}`]: { $literal: ocrResult } } });
    }

    const updatedClaim = await Claim.findOneAndUpdate(
      { id: claimId },
      updatePipeline,
      { new: true } // return the document AFTER the update, not before
    );

    if (!updatedClaim) {
      // The claim existed a moment ago and doesn't now — deleted mid-request.
      removeStoredFile(req.file.filename);
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    return res.status(201).json({ ...updatedClaim.toObject(), ocrWarning: warning });
  } catch (err) {
    // The file is already on disk but the database write failed — clean it up so
    // we don't accumulate files that nothing references.
    removeStoredFile(req.file.filename);
    console.error('Upload failed:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/claims/:claimId/documents/:docId  — REPLACE an existing document
// ---------------------------------------------------------------------------
router.put('/:claimId/documents/:docId', upload.single('file'), async (req, res) => {
  const problem = validateUpload(req);
  if (problem) {
    if (req.file) removeStoredFile(req.file.filename);
    return res.status(problem.status).json({ message: problem.message });
  }

  const { claimId, docId } = req.params;
  const { documentType } = req.body;
  const Claim = getClaimModel();

  try {
    const claim = await Claim.findOne({ id: claimId });
    if (!claim) {
      removeStoredFile(req.file.filename);
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    const index = (claim.documents || []).findIndex((doc) => doc.id === docId);
    if (index === -1) {
      removeStoredFile(req.file.filename);
      return res.status(404).json({ message: `No document "${docId}" on claim "${claimId}".` });
    }

    const previousDoc = claim.documents[index];
    const newDoc = buildDocumentRecord(req.file, documentType, previousDoc);
    const absoluteFilePath = path.join(uploadsDir, req.file.filename);

    // The old handler swapped the file and stopped there, leaving the PREVIOUS
    // document's extraction in ocrData — so the Edit License panel still showed
    // the old licence while a spinner claimed it had been re-analysed. Re-run it.
    const { section, data: ocrResult, warning } = await extractOcr(absoluteFilePath, documentType);

    let ocrSummary = null;
    const updatePipeline = [
      {
        // Walk the array server-side and swap the matching element. Same
        // pipeline-update approach as the POST route above, so docsCount gets
        // repaired here too if it was wrong.
        $set: {
          documents: {
            $map: {
              input: '$documents',
              as: 'doc',
              in: { $cond: [{ $eq: ['$$doc.id', docId] }, { $literal: newDoc }, '$$doc'] }
            }
          }
        }
      },
      { $set: { docsCount: { $size: '$documents' } } }
    ];

    if (ocrResult && section) {
      const { merged, preserved, filled } = mergeOcrSection(plainSection(claim, section), ocrResult);
      ocrSummary = { preserved, filled };
      updatePipeline.push({ $set: { [`ocrData.${section}`]: { $literal: merged } } });
    }

    const updatedClaim = await Claim.findOneAndUpdate(
      { id: claimId },
      updatePipeline,
      { new: true }
    );

    if (!updatedClaim) {
      removeStoredFile(req.file.filename);
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    // Only now that the database is updated do we delete the old file.
    removeStoredFile(previousDoc.storedFileName);

    return res.json({ ...updatedClaim.toObject(), ocrWarning: warning, ocrSummary });
  } catch (err) {
    removeStoredFile(req.file.filename);
    console.error('Replace failed:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/claims/:claimId/documents/:docId  — REMOVE a document
// ---------------------------------------------------------------------------
// Without this the only way to un-file a document was to edit MongoDB by hand.
//
// Unlike the two routes above this does NOT use a pipeline update: we already
// have the array in memory and are replacing it wholesale, so a plain $set is
// simpler and does the same job. Mongoose writes a plain array through to a
// Mixed path without complaint — the dirty-tracking problem only affects
// in-place mutation followed by .save().
router.delete('/:claimId/documents/:docId', async (req, res) => {
  const { claimId, docId } = req.params;
  const Claim = getClaimModel();

  try {
    const claim = await Claim.findOne({ id: claimId });
    if (!claim) {
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    const documents = (claim.toObject().documents || []);
    const target = documents.find(doc => doc.id === docId);
    if (!target) {
      return res.status(404).json({ message: `No document "${docId}" on claim "${claimId}".` });
    }

    const remaining = documents.filter(doc => doc.id !== docId);

    const update = {
      $set: { documents: remaining, docsCount: remaining.length }
    };

    // Clear the extracted fields too — otherwise the next upload of this type
    // would "merge" into a ghost of the document we just deleted.
    //
    // Only when nothing else on the claim maps to that section: two different
    // requirements can share one section (both motor-claim-form labels do), and
    // wiping it while the other document is still filed would lose its data.
    const section = ocrSectionForDocumentType(target.documentType);
    if (section) {
      const stillUsed = remaining.some(
        doc => ocrSectionForDocumentType(doc.documentType) === section
      );
      if (!stillUsed) {
        update.$unset = { [`ocrData.${section}`]: '' };
      }
    }

    const updatedClaim = await Claim.findOneAndUpdate({ id: claimId }, update, { new: true });

    // The database no longer references the file, so it is safe to bin it.
    removeStoredFile(target.storedFileName);

    return res.json(updatedClaim);
  } catch (err) {
    console.error('Delete failed:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// ERROR HANDLER for multer
// ---------------------------------------------------------------------------
// multer throws before our handlers run (e.g. the file is too big), so those
// errors need catching here or Express returns an HTML stack trace the frontend
// can't parse.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `File is too large. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`
      });
    }
    return res.status(400).json({ message: err.message });
  }
  return next(err);
});

export default router;
