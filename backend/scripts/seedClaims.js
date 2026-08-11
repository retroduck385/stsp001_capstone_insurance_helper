// scripts/seedClaims.js
//
// Inserts three sample claims — one per claim type — so the dashboard has data
// and each type's different requirements checklist is visible.
//
//   node scripts/seedClaims.js
//
// THIS SCRIPT IS DELIBERATELY NON-DESTRUCTIVE.
// It targets a database shared with the rest of the team, so it:
//   * never drops a collection or deletes anything,
//   * never overwrites a claim that already exists,
//   * only inserts a claim when its id is absent, and reports what it did.
//
// Running it twice is safe — the second run will skip everything.
//
// Note: `ocrData` is intentionally omitted. The schema types it as a deeply
// nested object, while the frontend still expects a flat array. Seeding either
// shape would be wrong, so these claims carry none and the OCR pipeline can
// populate it later.

import 'dotenv/config';
import mongoose from 'mongoose';

// We deliberately do NOT import server.js — that file starts the API server as a
// side effect of being imported, which we don't want from a script.
//
// Instead we register a permissive model pointed at the same "claims"
// collection. `strict: false` means Mongoose writes our fields through as-is
// without needing a copy of the 200-line schema here (which would inevitably
// drift from the real one). `timestamps: true` supplies the createdAt that
// GET /api/claims sorts by.
const claimSchema = new mongoose.Schema({}, {
  strict: false,
  timestamps: true,
  id: false,
  collection: 'claims'
});
mongoose.model('Claim', claimSchema);

const SAMPLE_CLAIMS = [
  {
    id: 'CLM-2026-9001',
    policyholder: 'Juan Dela Cruz',
    email: 'juan.delacruz@example.com',
    driverName: 'Juan Dela Cruz',
    vehicle: 'Toyota Vios 2021 (ABC 1234)',
    claimType: 'Own Damage',
    status: 'In Assessment',
    category: 'Motor',
    claimedAmount: 65000,
    recommendedPayout: 52000,
    isFlagged: true,
    flagSummary: '⚠️ Awaiting document verification',
    docsCount: 0,
    documents: [],
    rules: [
      { type: 'green', title: 'Policy Active', text: 'Coverage was in force on the date of loss.' },
      { type: 'yellow', title: 'Documents Pending', text: 'Required documents have not yet been uploaded and verified.' }
    ],
    citation: 'Section III — Loss or Damage: the Company will indemnify the Insured against loss or damage to the Schedule Vehicle.'
  },
  {
    id: 'CLM-2026-9002',
    policyholder: 'Maria Santos',
    email: 'maria.santos@example.com',
    driverName: 'Maria Santos',
    vehicle: 'Honda Civic 2019 (XYZ 5678)',
    claimType: 'Third-Party Property Damage',
    status: 'In Assessment',
    category: 'Motor',
    claimedAmount: 48000,
    recommendedPayout: 40000,
    isFlagged: false,
    flagSummary: '✓ No exceptions detected',
    docsCount: 0,
    documents: [],
    rules: [
      { type: 'green', title: 'Policy Active', text: 'Coverage was in force on the date of loss.' },
      { type: 'green', title: 'Third-Party Liability Covered', text: 'Property damage to third parties falls within the policy limit.' }
    ],
    citation: 'Section IV — Third Party Liability: the Company will indemnify the Insured against liability for damage to property belonging to a third party.'
  },
  {
    id: 'CLM-2026-9003',
    policyholder: 'Pedro Ramirez',
    email: 'pedro.ramirez@example.com',
    driverName: 'Pedro Ramirez',
    vehicle: 'Mitsubishi Montero 2020 (DEF 9012)',
    claimType: 'Third-Party Bodily Injury / Death',
    status: 'In Assessment',
    category: 'Motor',
    claimedAmount: 120000,
    recommendedPayout: 70000,
    isFlagged: true,
    flagSummary: '🔴 Bodily injury — medical documents required',
    docsCount: 0,
    documents: [],
    rules: [
      { type: 'green', title: 'Policy Active', text: 'Coverage was in force on the date of loss.' },
      { type: 'red', title: 'Medical Evidence Missing', text: 'Medical certificate and hospital SOA are required before assessment can conclude.' }
    ],
    citation: 'Section IV — Third Party Liability: bodily injury or death indemnity is payable per the Schedule of Indemnities.'
  }
];

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Create backend/.env first (see .env.example).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;
  console.log(`Connected to MongoDB — database "${dbName}"\n`);

  const Claim = mongoose.model('Claim');

  const existingCount = await Claim.countDocuments();
  console.log(`The "claims" collection currently holds ${existingCount} claim(s).`);
  console.log('This script only ADDS claims — nothing existing will be modified.\n');

  let inserted = 0;
  let skipped = 0;

  for (const claim of SAMPLE_CLAIMS) {
    const existing = await Claim.findOne({ id: claim.id });
    if (existing) {
      console.log(`  SKIP    ${claim.id}  (already exists — left untouched)`);
      skipped++;
      continue;
    }
    await Claim.create(claim);
    console.log(`  INSERT  ${claim.id}  ${claim.claimType}`);
    inserted++;
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
  console.log(`The collection now holds ${await Claim.countDocuments()} claim(s).`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('\nSeeding failed:', err.message);
  process.exit(1);
});
