 // --- CLAIM TYPE / DOCUMENT REQUIREMENT LOGIC ---
    // Requirements below are taken directly from the supplied Motor Claim Form.
    // The checklist is adjuster-confirmed: a file can be detected by the system,
    // but the adjuster must tick the requirement after verifying the submitted file.
    
export const claimRequirements = {
      'Own Damage': [
        'Completed Motor Claim Form',
        'Police Report OR Notarized Affidavit / Facts of Accident',
        'Certificate of Registration + Official Receipt',
        "Driver's License + Official Receipt",
        'Pictures of Vehicle Damages',
        'Repair Estimate',
        'Certificate of No Claim from Third Party Insurer (if third party vehicle involved)',
        'Authorization Letter for Vehicle Use (if another person drove the vehicle)'
      ],
      'Third-Party Property Damage': [
        'Completed Motor Claim Form',
        'Police Report OR Notarized Affidavit / Facts of Accident',
        'Certificate of Registration + Official Receipt',
        "Driver's License + Official Receipt",
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