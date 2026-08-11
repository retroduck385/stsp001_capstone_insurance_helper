// routes/ocr.js
//
// Persists adjuster corrections to the OCR-extracted fields.
//
// Mounted at /api/claims by server.js:
//   PATCH /api/claims/:claimId/ocr
//
// Body (JSON) — a partial ocrData object containing only what changed:
//
//   { "driversLicense": { "driver_license_name": "Juan Dela Cruz" },
//     "motorClaimForm": { "assured_mobile": "0917..." } }
//
// PATCH rather than PUT because it is a partial update: fields not mentioned
// are left exactly as they are.
//
// The frontend builds this body with buildOcrPatch() in services/ocrAdapter.js.

import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

const getClaimModel = () => mongoose.model('Claim');

// Only these top-level keys exist under ocrData in the schema. Anything else is
// rejected rather than silently ignored, so a typo surfaces immediately instead
// of looking like a save that didn't stick.
const VALID_SECTIONS = [
  'motorClaimForm', 'policeReportOrAffidavit', 'certificateOfRegistration',
  'driversLicense', 'repairEstimate', 'certificateOfNoClaim', 'authorizationLetter',
  'medicalCertificate', 'hospitalBillSOA', 'medicalReceipts',
  'releaseOfClaimOrDesistance', 'validIdOfClaimant', 'deathCertificate',
  'birthCertificate', 'funeralExpenses', 'vehicleDamagePictures'
];

router.patch('/:claimId/ocr', async (req, res) => {
  const { claimId } = req.params;
  const patch = req.body;

  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return res.status(400).json({
      message: 'Body must be an object of ocrData sections, e.g. { "driversLicense": { "driver_license_name": "..." } }.'
    });
  }

  const unknown = Object.keys(patch).filter(key => !VALID_SECTIONS.includes(key));
  if (unknown.length > 0) {
    return res.status(400).json({
      message: `Unknown ocrData section(s): ${unknown.join(', ')}. Valid sections are: ${VALID_SECTIONS.join(', ')}.`
    });
  }

  try {
    // Build dot-notation paths so we update individual FIELDS rather than
    // replacing whole sections:
    //
    //   { "ocrData.driversLicense.driver_license_name": "Juan Dela Cruz" }
    //
    // Using { $set: { "ocrData.driversLicense": {...} } } instead would wipe
    // every other field in that section — a classic way to lose data.
    const updates = {};
    for (const [sectionKey, fields] of Object.entries(patch)) {
      if (!fields || typeof fields !== 'object') continue;
      for (const [fieldId, value] of Object.entries(fields)) {
        updates[`ocrData.${sectionKey}.${fieldId}`] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No fields to update.' });
    }

    const updatedClaim = await getClaimModel().findOneAndUpdate(
      { id: claimId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedClaim) {
      return res.status(404).json({ message: `No claim found with id "${claimId}".` });
    }

    return res.json(updatedClaim);
  } catch (err) {
    console.error('OCR update failed:', err);
    // A CastError means the value didn't fit the schema's type for that field,
    // e.g. text typed into a Date field.
    if (err.name === 'CastError' || err.name === 'ValidationError') {
      return res.status(400).json({ message: `Could not save: ${err.message}` });
    }
    return res.status(500).json({ message: err.message });
  }
});

export default router;
