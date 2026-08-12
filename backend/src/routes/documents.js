// routes/documents.js
//
// File-upload endpoints for claim documents.
//
// Mounted at /api/claims by server.js, so the routes below resolve to:
//   POST /api/claims/:claimId/documents            → upload a new document
//   PUT  /api/claims/:claimId/documents/:docId     → replace an existing document
//
// HOW AN UPLOAD WORKS, end to end:
//   1. The browser sends a `multipart/form-data` request (a FormData object).
//      This is NOT JSON — express.json() cannot read it, which is why multer exists.
//   2. multer parses the request, writes the file into backend/uploads/, and hands
//      us the details on `req.file`. Plain text fields land on `req.body`.
//   3. We build a small metadata object describing the file and push it into the
//      claim's `documents` array in MongoDB.
//   4. We respond with the whole updated claim so the frontend can just replace
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

// Builds the object that gets stored in the claim's `documents` array.
// The property names here are what DocumentPreview.jsx already reads, so the
// frontend rendering code needs no changes.
function buildDocumentRecord(file, documentType, existingDoc = null) {
  const isPdf = file.mimetype === 'application/pdf';
  const isImage = file.mimetype.startsWith('image/');
  const publicUrl = `/uploads/${file.filename}`;

  return {
    id: existingDoc?.id || `doc-${Date.now()}`,
    // On replace, keep the old title: requirement matching is done on title text,
    // so changing it would detach the document from its checklist row.
    title: existingDoc?.title || file.originalname,
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
// POST /api/claims/:claimId/documents  — upload a NEW document
// ---------------------------------------------------------------------------
// router.post('/:claimId/documents', upload.single('file'), async (req, res) => {
//   const problem = validateUpload(req);
//   if (problem) {
//     if (req.file) removeStoredFile(req.file.filename); // don't leave the file behind
//     return res.status(problem.status).json({ message: problem.message });
//   }

//   const { claimId } = req.params;
//   const Claim = getClaimModel();

//   try {
//     const newDoc = buildDocumentRecord(req.file, req.body.documentType);

//     // WHY NOT claim.documents.push(...) + claim.save():
//     // `documents` is declared as [mongoose.Schema.Types.Mixed]. Mongoose cannot
//     // detect in-place changes to Mixed paths, so the push-then-save version
//     // silently saves nothing. Telling MongoDB directly what to do sidesteps the
//     // problem entirely (and is atomic).
//     //
//     // This is an aggregation-pipeline update — the array of stages below runs
//     // server-side, in order. We append the document, then recompute docsCount
//     // from the array's actual length rather than incrementing it. Some existing
//     // claims have a docsCount that disagrees with their documents array, and
//     // $inc would preserve that error forever; $size repairs it on every write.
//     //
//     // $literal stops MongoDB from interpreting any string in our object that
//     // happens to begin with "$" as a field reference.
//     const updatedClaim = await Claim.findOneAndUpdate(
//       { id: claimId },
//       [
//         { $set: { documents: { $concatArrays: [{ $ifNull: ['$documents', []] }, { $literal: [newDoc] }] } } },
//         { $set: { docsCount: { $size: '$documents' } } }
//       ],
//       { new: true } // return the document AFTER the update, not before
//     );

//     if (!updatedClaim) {
//       removeStoredFile(req.file.filename); // the claim doesn't exist — bin the file
//       return res.status(404).json({ message: `No claim found with id "${claimId}".` });
//     }

//     return res.status(201).json(updatedClaim);
//   } catch (err) {
//     // The file is already on disk but the database write failed — clean it up so
//     // we don't accumulate files that nothing references.
//     removeStoredFile(req.file.filename);
//     console.error('Upload failed:', err);
//     return res.status(500).json({ message: err.message });
//   }
// });

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
  const Claim = getClaimModel();

  try {
    const newDoc = buildDocumentRecord(req.file, req.body.documentType);
    const absoluteFilePath = path.join(uploadsDir, req.file.filename);

    // 1. Run the AI OCR if it is a supported document type
    let ocrResult = null;
    let docType = req.body.documentType; 
    
    // TRANSLATION BLOCK: Convert frontend string to database schema key
    if (docType === 'Completed Motor Claim Form') {
      docType = 'motorClaimForm';
    } else if (docType === "Philippine Driver's License" || docType.includes("Driver's License")) {
      docType = 'driversLicense';
    }

    // Now it will correctly match and run!
    if (docType === 'motorClaimForm' || docType === 'driversLicense') {
      console.log(`Starting AI extraction for ${docType}...`);
      ocrResult = await runGeminiOCR(absoluteFilePath, docType);
      console.log('AI Extraction successful!');
    }

    // 2. Build the MongoDB Aggregation Pipeline
    const updatePipeline = [
      { $set: { documents: { $concatArrays: [{ $ifNull: ['$documents', []] }, { $literal: [newDoc] }] } } },
      { $set: { docsCount: { $size: '$documents' } } }
    ];

    // 3. Surgically inject the OCR data if we successfully extracted it
    if (ocrResult) {
      updatePipeline.push({ 
        $set: { [`ocrData.${docType}`]: { $literal: ocrResult } } 
      });
    }

    // 4. Execute the final database update
    const updatedClaim = await Claim.findOneAndUpdate(
      { id: claimId },
      updatePipeline,
      { new: true } 
    );

    if (!updatedClaim) {
      removeStoredFile(req.file.filename); 
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    return res.status(201).json(updatedClaim);
  } catch (err) {
    removeStoredFile(req.file.filename);
    console.error('Upload & OCR failed:', err);
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
    const newDoc = buildDocumentRecord(req.file, req.body.documentType, previousDoc);

    // Walk the array server-side and swap the matching element. Same
    // pipeline-update approach as the POST route above, so docsCount gets
    // repaired here too if it was wrong.
    const updatedClaim = await Claim.findOneAndUpdate(
      { id: claimId },
      [
        {
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
      ],
      { new: true }
    );

    // Only now that the database is updated do we delete the old file.
    removeStoredFile(previousDoc.storedFileName);

    return res.json(updatedClaim);
  } catch (err) {
    removeStoredFile(req.file.filename);
    console.error('Replace failed:', err);
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

function runGeminiOCR(filePath, documentType) {
  return new Promise((resolve, reject) => {
    // Note: 'python' might need to be 'python3' depending on your OS/venv setup
    const pythonProcess = spawn('python3', ['scripts/gemini_ocr.py', filePath, documentType]);
    
    let extractedData = '';

    // Catch the JSON printed by Python
    pythonProcess.stdout.on('data', (data) => {
      extractedData += data.toString();
    });

    // Catch any Python errors
    pythonProcess.stderr.on('data', (data) => {
      console.error('Python Error:', data.toString());
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python script exited with code ${code}`));
      }
      try {
        // Parse the stringified JSON back into a JavaScript object
        resolve(JSON.parse(extractedData));
      } catch (err) {
        reject(new Error('Failed to parse JSON from Python output.'));
      }
    });
  });
}

export default router;
