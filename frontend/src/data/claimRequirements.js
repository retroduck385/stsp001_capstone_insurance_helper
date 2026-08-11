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

// Keywords used to match an uploaded file name / title / caption back to the
// requirement it satisfies. Keys must be the lowercased requirement strings above.
export const requirementKeywords = {
  'completed motor claim form': ['claim form', 'motor claim form'],
  'police report or notarized affidavit / facts of accident': ['police report', 'affidavit', 'facts of accident'],
  'certificate of registration + official receipt': ['certificate of registration', 'registration', 'or/cr', 'official receipt'],
  "driver's license": ['driver license', "driver's license", 'philippine driver', 'dl scan', 'driver dl'],
  'official receipt (driver license / vehicle or other relevant or)': ['official receipt', 'or', 'payment receipt', 'receipt'],
  'pictures of vehicle damages': ['damage photo', 'vehicle damage', 'inspection photo', 'damaged vehicle'],
  'repair estimate': ['repair estimate', 'estimate'],
  'certificate of no claim from third party insurer (if third party vehicle involved)': ['no claim', 'no own damage', 'third party insurer'],
  'authorization letter for vehicle use (if another person drove the vehicle)': ['authorization letter', 'vehicle use'],
  'completed motor claim form or police report or notarized affidavit / facts of accident': ['claim form', 'police report', 'affidavit', 'facts of accident'],
  'medical certificate (diagnosis and treatment)': ['medical certificate'],
  'hospital bill or statement of account (soa)': ['hospital bill', 'statement of account', 'hospital'],
  'medical receipts': ['medical receipt', 'medical receipts'],
  'release of claim / notarized affidavit of desistance': ['release of claim', 'affidavit of desistance', 'desistance'],
  'valid id of claimant (government-issued id with date of birth, signature, and photo)': ['valid id', 'claimant id', 'government id', 'government-issued'],
  'death certificate (death claim only)': ['death certificate'],
  'birth certificate (death claim only)': ['birth certificate'],
  'funeral / burial expenses (death claim only)': ['funeral', 'burial']
};

export function documentMatchesRequirement(requirement, documents) {
  const requirementText = (requirement || '').toLowerCase().trim();

  return (documents || []).some(doc => {
    const documentType = (doc.documentType || '').toLowerCase().trim();

    // Primary match: the document was uploaded directly for this requirement.
    if (documentType === requirementText) {
      return true;
    }

    // Fallback: preserve the existing keyword-based matching.
    const text = [
      doc.title || '',
      doc.fileName || '',
      doc.caption || '',
      doc.documentType || ''
    ]
      .join(' ')
      .toLowerCase();

    const keys = requirementKeywords[requirementText] || [];

    return keys.some(k => text.includes(k.toLowerCase()));
  });
}
