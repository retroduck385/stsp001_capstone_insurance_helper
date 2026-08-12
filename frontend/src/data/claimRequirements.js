// --- CLAIM TYPE / DOCUMENT REQUIREMENT LOGIC ---
// Requirements below are taken directly from the supplied Motor Claim Form.
// The checklist is adjuster-confirmed: a file can be detected by the system,
// but the adjuster must tick the requirement after verifying the submitted file.

export const claimRequirements = {
  'Own Damage': [
    'Completed Motor Claim Form',
    'Police Report OR Notarized Affidavit / Facts of Accident',
    'Certificate of Registration + Official Receipt',
    "Driver's License",
    'Official Receipt (Driver License / Vehicle OR other relevant OR)',
    'Pictures of Vehicle Damages',
    'Repair Estimate',
    'Certificate of No Claim from Third Party Insurer (if third party vehicle involved)',
    'Authorization Letter for Vehicle Use (if another person drove the vehicle)'
  ],
  'Third-Party Property Damage': [
    'Completed Motor Claim Form',
    'Police Report OR Notarized Affidavit / Facts of Accident',
    'Certificate of Registration + Official Receipt',
    "Driver's License",
    'Official Receipt (Driver License / Vehicle OR other relevant OR)',
    'Pictures of Vehicle Damages',
    'Repair Estimate',
    'Certificate of No Claim from Third Party Insurer (if third party vehicle involved)',
    'Authorization Letter for Vehicle Use (if another person drove the vehicle)'
  ],
  'Third-Party Bodily Injury / Death': [
    'Completed Motor Claim Form OR Police Report OR Notarized Affidavit / Facts of Accident',
    'Medical Certificate (diagnosis and treatment)',
    'Hospital Bill or Statement of Account (SOA)',
    'Medical Receipts',
    'Release of Claim / Notarized Affidavit of Desistance',
    'Valid ID of Claimant (government-issued ID with date of birth, signature, and photo)',
    'Death Certificate (Death Claim only)',
    'Birth Certificate (Death Claim only)',
    'Funeral / Burial Expenses (Death Claim only)'
  ]
};

/** Every requirement label used by any claim type, lowercased. */
export const REQUIREMENT_LABELS = new Set(
  Object.values(claimRequirements).flat().map(req => req.toLowerCase().trim())
);

// Keywords used to guess which requirement a LEGACY document satisfies — one
// uploaded before `documentType` existed, or seeded straight into MongoDB.
// Documents that carry a `documentType` never consult this table; see
// documentMatchesRequirement below.
//
// ── DO NOT ADD SHORT OR COMMON WORDS HERE ────────────────────────────────
// These are substring-matched. The previous version listed 'or' for the
// official-receipt requirement, which matched the word "f-or" inside every
// document's caption ("Uploaded by adjuster for claim review."). The result was
// that EVERY document on a claim registered against the Official Receipt row,
// which then offered a Replace button wired to somebody else's document.
// 'receipt', 'estimate', 'registration' and 'hospital' were removed for the
// same reason — they collide across requirements.
export const requirementKeywords = {
  'completed motor claim form': ['motor claim form', 'claim form'],
  'police report or notarized affidavit / facts of accident': ['police report', 'affidavit', 'facts of accident'],
  'certificate of registration + official receipt': ['certificate of registration', 'or/cr'],
  "driver's license": ['driver license', "driver's license", 'philippine driver', 'dl scan', 'driver dl'],
  'official receipt (driver license / vehicle or other relevant or)': ['official receipt', 'payment receipt'],
  'pictures of vehicle damages': ['damage photo', 'vehicle damage', 'inspection photo', 'damaged vehicle'],
  'repair estimate': ['repair estimate'],
  'certificate of no claim from third party insurer (if third party vehicle involved)': ['no claim', 'no own damage', 'third party insurer'],
  'authorization letter for vehicle use (if another person drove the vehicle)': ['authorization letter', 'vehicle use'],
  'completed motor claim form or police report or notarized affidavit / facts of accident': ['motor claim form', 'claim form', 'police report', 'affidavit', 'facts of accident'],
  'medical certificate (diagnosis and treatment)': ['medical certificate'],
  'hospital bill or statement of account (soa)': ['hospital bill', 'statement of account'],
  'medical receipts': ['medical receipt'],
  'release of claim / notarized affidavit of desistance': ['release of claim', 'affidavit of desistance', 'desistance'],
  'valid id of claimant (government-issued id with date of birth, signature, and photo)': ['valid id', 'claimant id', 'government id', 'government-issued'],
  'death certificate (death claim only)': ['death certificate'],
  'birth certificate (death claim only)': ['birth certificate'],
  'funeral / burial expenses (death claim only)': ['funeral', 'burial']
};

/**
 * Does this single document satisfy this single requirement?
 *
 * `documentType` IS AUTHORITATIVE AND EXCLUSIVE. It records the requirement row
 * the adjuster actually uploaded the file from, so a document filed under one
 * requirement must never also count for another — otherwise the wrong row shows
 * a Replace button pointed at somebody else's document, and replacing there
 * destroys the original file.
 *
 * The keyword guess is therefore a fallback for legacy documents ONLY: those
 * with no documentType at all.
 */
function documentSatisfies(doc, requirementText) {
  const documentType = (doc.documentType || '').toLowerCase().trim();

  if (documentType) {
    return documentType === requirementText;
  }

  // Legacy document with no documentType — fall back to keywords.
  //
  // `caption` is deliberately excluded: the backend stamps every upload with
  // the same fixed sentence, so matching against it can only ever produce
  // false positives.
  const text = [doc.title || '', doc.fileName || ''].join(' ').toLowerCase();
  const keys = requirementKeywords[requirementText] || [];

  return keys.some(k => text.includes(k));
}

export function documentMatchesRequirement(requirement, documents) {
  const requirementText = (requirement || '').toLowerCase().trim();
  return (documents || []).some(doc => documentSatisfies(doc, requirementText));
}

/**
 * The document filed against this requirement, or null.
 *
 * Prefer this over `documents.find(d => documentMatchesRequirement(req, [d]))`:
 * it returns the document whose `documentType` matches exactly, in preference
 * to any legacy keyword guess, so an explicitly filed document always wins.
 */
export function findDocumentForRequirement(requirement, documents) {
  const requirementText = (requirement || '').toLowerCase().trim();
  const docs = documents || [];

  const exact = docs.find(
    doc => (doc.documentType || '').toLowerCase().trim() === requirementText
  );
  if (exact) return exact;

  return docs.find(doc => documentSatisfies(doc, requirementText)) || null;
}
