// data/requirementSections.js
//
// THE SINGLE SOURCE OF TRUTH for "which ocrData section does this document
// belong to?" on the backend.
//
// The frontend uploads a document with a `documentType` that is the *literal
// requirement label* the adjuster clicked, e.g. "Completed Motor Claim Form".
// This file maps those labels onto the `ocrData.<section>` keys declared in
// src/server.js.
//
// WHY A MAP AND NOT STRING MATCHING:
// The previous version used `docType.includes("Driver's License")` and a
// hardcoded equality check against 'Completed Motor Claim Form'. Two things
// went wrong with that:
//
//   1. The Third-Party Bodily Injury / Death claim type labels its first
//      requirement "Completed Motor Claim Form OR Police Report OR Notarized
//      Affidavit / Facts of Accident". That is NOT equal to 'Completed Motor
//      Claim Form', so the check fell through and OCR never ran at all on that
//      claim type.
//   2. "Official Receipt (Driver License / Vehicle OR other relevant OR)"
//      contains the words "Driver License", so substring matching filed
//      receipts under the driver's licence section.
//
// An explicit table has neither problem. Keep the keys in sync with
// frontend/src/data/claimRequirements.js — they are the same strings, lowercased.
//
// A value of `null` means "this requirement has no ocrData section in the
// Mongoose schema", so no OCR is run and nothing is written. That is a
// deliberate, valid entry — not a gap.

export const OCR_SECTION_BY_REQUIREMENT = {
  // --- Own Damage / Third-Party Property Damage ---------------------------
  'completed motor claim form': 'motorClaimForm',
  'police report or notarized affidavit / facts of accident': 'policeReportOrAffidavit',
  'certificate of registration + official receipt': 'certificateOfRegistration',
  "driver's license": 'driversLicense',
  'official receipt (driver license / vehicle or other relevant or)': null,
  'pictures of vehicle damages': 'vehicleDamagePictures',
  'repair estimate': 'repairEstimate',
  'certificate of no claim from third party insurer (if third party vehicle involved)': 'certificateOfNoClaim',
  'authorization letter for vehicle use (if another person drove the vehicle)': 'authorizationLetter',

  // --- Third-Party Bodily Injury / Death ---------------------------------
  'completed motor claim form or police report or notarized affidavit / facts of accident': 'motorClaimForm',
  'medical certificate (diagnosis and treatment)': 'medicalCertificate',
  'hospital bill or statement of account (soa)': 'hospitalBillSOA',
  'medical receipts': 'medicalReceipts',
  'release of claim / notarized affidavit of desistance': 'releaseOfClaimOrDesistance',
  'valid id of claimant (government-issued id with date of birth, signature, and photo)': 'validIdOfClaimant',
  'death certificate (death claim only)': 'deathCertificate',
  'birth certificate (death claim only)': 'birthCertificate',
  'funeral / burial expenses (death claim only)': 'funeralExpenses'
};

// Only these two have a Gemini prompt written for them in scripts/gemini_ocr.py.
// Everything else maps to a section but has no extractor yet, so we skip the
// (slow, paid) model call rather than sending it the wrong prompt.
export const SECTIONS_WITH_OCR = new Set(['motorClaimForm', 'driversLicense', 'vehicleDamagePictures']);

/**
 * Requirement label (any casing) → ocrData section key, or null when the
 * requirement has no section. Unknown labels also return null.
 */
export function ocrSectionForDocumentType(documentType) {
  const key = String(documentType || '').toLowerCase().trim();
  return OCR_SECTION_BY_REQUIREMENT[key] ?? null;
}

/** True when we have a Gemini prompt capable of reading this document type. */
export function canRunOcrFor(documentType) {
  const section = ocrSectionForDocumentType(documentType);
  return section !== null && SECTIONS_WITH_OCR.has(section);
}
