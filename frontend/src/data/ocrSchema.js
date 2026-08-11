// data/ocrSchema.js
//
// The bridge between two different shapes of the same data.
//
// THE BACKEND stores ocrData as a nested object, one section per document type
// (backend/src/server.js):
//
//   ocrData: {
//     motorClaimForm:  { assured_full_name: "Juan Dela Cruz", ... },
//     driversLicense:  { driver_license_number: "N01-23-456789", ... },
//     ...16 sections total
//   }
//
// THE UI works with a flat array, where each entry knows which document it came
// from so it can be shown next to that document:
//
//   [ { fieldId: 'assured_full_name', label: '...', extractedValue: '...',
//       sourceDoc: 'doc-123', section: 'motorClaimForm' }, ... ]
//
// This file describes every section — its fields, their human-readable labels,
// and which uploaded document it belongs to — so services/ocrAdapter.js can
// convert between the two.
//
// KEEPING IT IN SYNC: if the backend developer adds a field to the Mongoose
// ocrData schema, add it here too or it simply won't appear in the UI. Nothing
// breaks; the field is just invisible.

/**
 * `documentKeywords` matches against a document's `documentType` — the claim
 * requirement label it was uploaded against, e.g. "Driver's License + Official
 * Receipt". Sections are checked IN ORDER and the first match wins, so more
 * specific entries must come first. ("Completed Motor Claim Form OR Police
 * Report..." contains both "motor claim form" and "police report", and should
 * resolve to the motor claim form.)
 */
export const OCR_SECTIONS = [
  {
    key: 'motorClaimForm',
    label: 'Motor Claim Form',
    documentKeywords: ['motor claim form', 'claim form'],
    fields: [
      // Section 2 — Assured's Details
      { id: 'assured_full_name', label: 'Full Name of Assured (Last, First, Middle)' },
      { id: 'assured_dob', label: 'Date of Birth (MM/DD/YYYY)' },
      { id: 'assured_place_of_birth', label: 'Place of Birth' },
      { id: 'assured_sex', label: 'Sex' },
      { id: 'assured_nationality', label: 'Nationality' },
      { id: 'assured_id_type', label: 'Type of Valid ID' },
      { id: 'assured_id_no', label: 'Valid ID No.' },
      { id: 'assured_tin_sss_gsis', label: 'TIN / SSS / GSIS Number' },
      { id: 'assured_email', label: 'Email Address' },
      { id: 'assured_mobile', label: 'Mobile No.' },
      { id: 'assured_home_phone', label: 'Home Phone No. (Optional)' },
      { id: 'assured_address', label: 'Residence / Present Address' },
      { id: 'assured_source_of_fund', label: 'Source of Fund' },
      { id: 'assured_is_pep', label: 'Is the Assured a PEP?' },
      // Section 3 — Insured Vehicle's Information
      { id: 'vehicle_year', label: 'Year' },
      { id: 'vehicle_model', label: 'Model' },
      { id: 'vehicle_make', label: 'Make' },
      { id: 'vehicle_type', label: 'Type' },
      { id: 'vehicle_engine_no', label: 'Engine No.' },
      { id: 'vehicle_registered_owner', label: 'Registered Owner (Last, First, Middle)' },
      { id: 'vehicle_chassis_no', label: 'Serial / Chassis No.' },
      { id: 'vehicle_plate_no', label: 'Plate No.' },
      // Section 4 — Driver's Information
      { id: 'driver_full_name', label: 'Full Name of Driver' },
      { id: 'driver_age', label: 'Age' },
      { id: 'driver_license_type', label: 'License Type' },
      { id: 'driver_license_no', label: 'License No.' },
      { id: 'driver_license_expiry', label: 'License Expiry Date (MM/DD/YYYY)' },
      { id: 'driver_address', label: 'Residence / Present Address (Driver)' },
      { id: 'driver_is_employee', label: 'Is the Driver an Employee of the Assured?' },
      { id: 'driver_relationship', label: 'If Yes, provide nature of relationship' },
      { id: 'driver_authorized_by', label: 'Who authorized the driver to use the vehicle?' },
      // Section 5 — Details of the Accident or Loss
      { id: 'accident_date', label: 'Date of Accident or Loss (MM/DD/YYYY)' },
      { id: 'accident_time', label: 'Time of Accident or Loss (HH:MM)' },
      { id: 'accident_weather', label: 'Weather during the Accident or Loss' },
      { id: 'accident_place', label: 'Place of Accident or Loss' },
      { id: 'accident_police_authority', label: 'Full Name of Police Authority (if reported)' },
      // Section 6 — Additional Details
      { id: 'nature_of_business', label: 'Nature of Business' },
      { id: 'purpose_of_use', label: 'Purpose of Use of the Vehicle' },
      { id: 'vehicle_used_for_hire', label: 'Is the vehicle being used for hire / rent?' },
      { id: 'registered_in_pami_tnvs', label: 'Is the vehicle registered in PAMI / TNVS?' },
      { id: 'direction_during_accident', label: 'Direction of the vehicle during the accident' },
      { id: 'speed_rate_vehicle', label: 'Speed rate of the vehicle during the accident' },
      { id: 'direction_other_party', label: "Direction of other party's vehicle during the accident" },
      { id: 'speed_rate_other_party', label: "Speed rate of other party's vehicle during the accident" },
      { id: 'party_at_fault', label: 'Party at fault (if any)' },
      { id: 'settlements_made', label: "Settlements made with other party's vehicle (if any)" },
      // Section 7
      { id: 'reason_for_late_filing', label: 'Reason for Late Filing' },
      // Sections 8 & 9 — tables, handled by DocumentFormEditor
      { id: 'affected_persons', label: 'List of Affected Persons (table)', isTable: true },
      { id: 'description_of_damage', label: 'Description of Damage/s (table)', isTable: true },
      { id: 'current_location_of_vehicle', label: 'Current Location of Vehicle' },
      // Payment & Authorization
      { id: 'payment_bank_name', label: 'Bank Name (for payout)' },
      { id: 'payment_account_number', label: 'Account Number of Payee' },
      { id: 'payment_account_name', label: 'Account Name of Payee' },
      { id: 'authorization_text', label: 'Authorization / Declaration Text (short)' }
    ]
  },
  {
    key: 'driversLicense',
    label: "Driver's License",
    // Checked before certificateOfRegistration: both requirement labels end in
    // "+ Official Receipt", so we match on the distinctive part.
    documentKeywords: ["driver's license", 'driver license', 'drivers license'],
    fields: [
      { id: 'driver_license_number', label: 'License Number' },
      { id: 'driver_license_name', label: 'Name on License' },
      { id: 'driver_license_dob', label: 'Date of Birth' },
      { id: 'driver_license_address', label: 'Address' },
      { id: 'driver_license_class', label: 'License Class / Codes' },
      { id: 'driver_license_expiry_date', label: 'Expiry Date' },
      { id: 'driver_license_restrictions', label: 'Restrictions' },
      { id: 'driver_license_place_of_issue', label: 'Place of Issue' },
      { id: 'driver_license_control_no', label: 'Control Number' },
      { id: 'driver_license_blood_type', label: 'Blood Type' },
      { id: 'driver_license_official_receipt', label: 'Official Receipt No.' }
      // NOTE: driver_license_type and driver_license_issue_date are commented
      // out in the Mongoose schema (server.js), so they are omitted here. The
      // DriverLicenseEditor renders no inputs for them either.
    ]
  },
  {
    key: 'certificateOfRegistration',
    label: 'Certificate of Registration',
    documentKeywords: ['certificate of registration', 'registration'],
    fields: [
      { id: 'registeredOwner', label: 'Registered Owner' },
      { id: 'plateNumber', label: 'Plate Number' },
      { id: 'makeAndModel', label: 'Make and Model' },
      { id: 'engineNumber', label: 'Engine Number' },
      { id: 'orReceiptDate', label: 'Official Receipt Date', isDate: true }
    ]
  },
  {
    key: 'policeReportOrAffidavit',
    label: 'Police Report / Affidavit',
    documentKeywords: ['police report', 'affidavit', 'facts of accident'],
    fields: [
      { id: 'reportDate', label: 'Report Date', isDate: true },
      { id: 'reportingOfficer', label: 'Reporting Officer' },
      { id: 'incidentSummary', label: 'Incident Summary' }
    ]
  },
  {
    key: 'repairEstimate',
    label: 'Repair Estimate',
    documentKeywords: ['repair estimate', 'estimate'],
    fields: [
      { id: 'shopName', label: 'Repair Shop Name' },
      { id: 'estimateDate', label: 'Estimate Date', isDate: true },
      { id: 'totalEstimatedCost', label: 'Total Estimated Cost', isNumber: true },
      { id: 'detectedParts', label: 'Detected Parts', isTable: true }
    ]
  },
  {
    key: 'certificateOfNoClaim',
    label: 'Certificate of No Claim',
    documentKeywords: ['no claim', 'third party insurer'],
    fields: [
      { id: 'thirdPartyInsurerName', label: 'Third Party Insurer' },
      { id: 'issueDate', label: 'Issue Date', isDate: true },
      { id: 'confirmationStatus', label: 'Confirmation Status' }
    ]
  },
  {
    key: 'authorizationLetter',
    label: 'Authorization Letter',
    documentKeywords: ['authorization letter', 'vehicle use'],
    fields: [
      { id: 'authorizedDriverName', label: 'Authorized Driver' },
      { id: 'ownerName', label: 'Vehicle Owner' },
      { id: 'authorizationDate', label: 'Authorization Date', isDate: true }
    ]
  },
  {
    key: 'medicalCertificate',
    label: 'Medical Certificate',
    documentKeywords: ['medical certificate'],
    fields: [
      { id: 'patientName', label: 'Patient Name' },
      { id: 'attendingPhysician', label: 'Attending Physician' },
      { id: 'diagnosis', label: 'Diagnosis' },
      { id: 'treatmentDate', label: 'Treatment Date', isDate: true }
    ]
  },
  {
    key: 'hospitalBillSOA',
    label: 'Hospital Bill / SOA',
    documentKeywords: ['hospital bill', 'statement of account', 'soa'],
    fields: [
      { id: 'hospitalName', label: 'Hospital Name' },
      { id: 'billingDate', label: 'Billing Date', isDate: true },
      { id: 'totalAmountDue', label: 'Total Amount Due', isNumber: true }
    ]
  },
  {
    key: 'medicalReceipts',
    label: 'Medical Receipts',
    documentKeywords: ['medical receipt'],
    fields: [
      { id: 'receiptNumbers', label: 'Receipt Numbers', isTable: true },
      { id: 'totalAmountPaid', label: 'Total Amount Paid', isNumber: true }
    ]
  },
  {
    key: 'releaseOfClaimOrDesistance',
    label: 'Release of Claim / Desistance',
    documentKeywords: ['release of claim', 'desistance'],
    fields: [
      { id: 'claimantName', label: 'Claimant Name' },
      { id: 'settlementAmount', label: 'Settlement Amount', isNumber: true },
      { id: 'dateSigned', label: 'Date Signed', isDate: true }
    ]
  },
  {
    key: 'validIdOfClaimant',
    label: 'Valid ID of Claimant',
    documentKeywords: ['valid id', 'government-issued', 'claimant id'],
    fields: [
      { id: 'idType', label: 'ID Type' },
      { id: 'idNumber', label: 'ID Number' },
      { id: 'fullName', label: 'Full Name' },
      { id: 'dateOfBirth', label: 'Date of Birth', isDate: true }
    ]
  },
  {
    key: 'deathCertificate',
    label: 'Death Certificate',
    documentKeywords: ['death certificate'],
    fields: [
      { id: 'deceasedName', label: 'Deceased Name' },
      { id: 'dateOfDeath', label: 'Date of Death', isDate: true },
      { id: 'causeOfDeath', label: 'Cause of Death' }
    ]
  },
  {
    key: 'birthCertificate',
    label: 'Birth Certificate',
    documentKeywords: ['birth certificate'],
    fields: [
      { id: 'fullName', label: 'Full Name' },
      { id: 'dateOfBirth', label: 'Date of Birth', isDate: true },
      { id: 'parentsNames', label: "Parents' Names" }
    ]
  },
  {
    key: 'funeralExpenses',
    label: 'Funeral / Burial Expenses',
    documentKeywords: ['funeral', 'burial'],
    fields: [
      { id: 'funeralParlorName', label: 'Funeral Parlor' },
      { id: 'totalAmount', label: 'Total Amount', isNumber: true },
      { id: 'receiptDate', label: 'Receipt Date', isDate: true }
    ]
  },
  {
    key: 'vehicleDamagePictures',
    label: 'Vehicle Damage Pictures',
    documentKeywords: ['vehicle damage', 'damage photo', 'pictures of vehicle'],
    fields: [
      { id: 'damageDescription', label: 'Damage Description' },
      { id: 'severity', label: 'Severity' }
    ]
  }
];

/** Fast lookup: section key → section definition. */
export const SECTION_BY_KEY = Object.fromEntries(OCR_SECTIONS.map(s => [s.key, s]));

/**
 * Which ocrData section does this document belong to?
 * Matches on `documentType` (the requirement it was uploaded against), falling
 * back to the filename/title for documents that predate documentType.
 * Returns the section key, or null when nothing matches.
 */
export function sectionKeyForDocument(doc) {
  if (!doc) return null;
  const haystack = `${doc.documentType || ''} ${doc.title || ''} ${doc.fileName || ''}`.toLowerCase();
  const section = OCR_SECTIONS.find(s => s.documentKeywords.some(k => haystack.includes(k)));
  return section ? section.key : null;
}
