// scripts/seedClaims.js
//
//   node scripts/seedClaims.js       (or: npm run seed)
//
// Inserts the demo dataset the fraud advisory module is developed and
// demonstrated against.
//
// THIS SCRIPT IS DELIBERATELY NON-DESTRUCTIVE.
// It targets a database shared with the rest of the team, so it:
//   * never drops a collection or deletes anything,
//   * never overwrites a claim that already exists,
//   * only inserts a claim when its id is absent, and reports what it did.
// Running it twice is safe — the second run skips everything.
//
//
// ── WHY EVERY ID STARTS WITH "DEMO-" ─────────────────────────────────────────
// The live `claims` collection already holds real working claims (CLM-2026-9001
// … 9004) with uploaded files and genuine OCR output. Those are not touched.
// The synthetic claims below carry a DEMO- prefix so that anyone looking at the
// database, the dashboard or a log line can tell at a glance which claims are
// fabricated for the fraud demo and which are real work.
//
//
// ── WHY ocrData IS NOW SEEDED (it used to be omitted) ────────────────────────
// The old comment here said ocrData was left out because the schema stores a
// nested object while the frontend wants a flat array. That is no longer a
// reason to omit it: MongoDB stores the nested shape, and normaliseClaim() in
// frontend/src/services/api.js flattens it on the way to the UI. Seeding the
// nested shape is therefore correct, and it is required — the demo claims have
// no uploaded documents, so the only way FR-02 and FR-03 have anything to read
// is for the seeder to supply it.
//
//
// ── THE createdAt TRAP ───────────────────────────────────────────────────────
// Every FR-02 rule is a question about WHEN claims were filed: how many in five
// years, how many in twelve months, any two inside ninety days. All of them read
// `claim.createdAt`.
//
// Mongoose's `timestamps: true` stamps createdAt with the current time on save
// and silently discards whatever historical date we set. Every "prior" claim
// would then land in the same week and every window rule would produce a
// confidently wrong answer — the module would look like it worked.
//
// So these documents are inserted through the raw driver (Claim.collection),
// which writes exactly the fields given and applies no timestamp behaviour.
// createdAt and updatedAt are set explicitly below.

import 'dotenv/config';
import mongoose from 'mongoose';

// We deliberately do NOT import server.js — that file starts the API server as a
// side effect of being imported, which we don't want from a script.
//
// `strict: false` means our fields are written through as-is without needing a
// copy of the 200-line schema here (which would inevitably drift from the real
// one). Timestamps are declared for parity with the real model, but the inserts
// below bypass them on purpose — see "THE createdAt TRAP" above.
const claimSchema = new mongoose.Schema({}, {
  strict: false,
  timestamps: true,
  id: false,
  collection: 'claims'
});
mongoose.model('Claim', claimSchema);

// ---------------------------------------------------------------------------
// DATE HELPERS
// ---------------------------------------------------------------------------
// All demo dates are relative to the moment the seeder runs, so the dataset
// stays meaningful however long after it was written the demo happens. A fixed
// calendar date would drift out of the five-year window and quietly stop firing.

const NOW = new Date();

/** A Date `n` months before now. */
function monthsAgo(n) {
  const date = new Date(NOW);
  date.setMonth(date.getMonth() - n);
  return date;
}

/** A Date `n` days before the given date. */
function daysBefore(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() - n);
  return out;
}

/** A Date `n` days after the given date. */
function daysAfter(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

/** 'MM/DD/YYYY' — the format the motor claim form asks for, and what OCR yields. */
function formToDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// CLAIMANT IDENTITIES
// ---------------------------------------------------------------------------
// One stable government id per claimant, reused across every one of their
// claims. This is what backend/src/services/claimantIdentity.js matches on, and
// it is the ONLY use these fields are put to — never as a risk signal
// (guardrail 6).

const CLAIMANTS = {
  juan:   { name: 'Juan Dela Cruz', email: 'juan.delacruz@example.com',  idNo: 'JDC-1985-004521', plate: 'ABC 1234' },
  maria:  { name: 'Maria Santos',   email: 'maria.santos@example.com',   idNo: 'MSS-1990-118834', plate: 'XYZ 5678' },
  pedro:  { name: 'Pedro Ramirez',  email: 'pedro.ramirez@example.com',  idNo: 'PRR-1978-772310', plate: 'DEF 9012' },
  andrea: { name: 'Andrea Lim',     email: 'andrea.lim@example.com',     idNo: 'ALM-1995-330198', plate: 'GHI 3456' }
};

/**
 * Builds the nested ocrData block a demo claim needs.
 *
 * `nameOnForm` defaults to the claimant's real name and is overridden on
 * exactly one of Juan's historical claims — see HISTORICAL_CLAIMS.
 */
function ocrDataFor(claimant, {
  accidentDate,
  estimateDate,
  estimatedCost = null,
  detectedParts = [],
  severity = null,
  damageDescription = null,
  nameOnForm = null
} = {}) {
  return {
    motorClaimForm: {
      assured_full_name: nameOnForm || claimant.name,
      assured_id_type: 'Government ID',
      assured_id_no: claimant.idNo,
      assured_email: claimant.email,
      vehicle_plate_no: claimant.plate,
      driver_full_name: claimant.name,
      accident_date: accidentDate ? formToDate(accidentDate) : null
    },
    repairEstimate: {
      shopName: 'Metro Auto Works',
      estimateDate: estimateDate || null,
      totalEstimatedCost: estimatedCost,
      detectedParts
    },
    vehicleDamagePictures: {
      damageDescription,
      severity
    }
  };
}

/** Fields every demo claim carries, so the four case definitions stay readable. */
function demoClaim({
  id,
  claimant,
  status,
  claimType,
  claimedAmount,
  recommendedPayout = null,
  approvedPayout = null,
  createdAt,
  decidedAt = null,
  flagSummary,
  isFlagged = false,
  ocrData
}) {
  return {
    id,
    policyholder: claimant.name,
    email: claimant.email,
    driverName: claimant.name,
    vehicle: `Demo vehicle (${claimant.plate})`,
    claimType,
    status,
    category: 'Motor',
    claimedAmount,
    recommendedPayout,
    approvedPayout,
    decisionReason: '',
    decidedAt,
    confirmedRequirements: [],
    isFlagged,
    flagSummary,
    docsCount: 0,
    documents: [],
    // Left empty on purpose. `rules` is the POLICY verdict (covered / not
    // covered). Fraud signals never go in here — guardrail 8.
    rules: [],
    citation: '',
    ocrData,
    createdAt,
    updatedAt: createdAt
  };
}

// ---------------------------------------------------------------------------
// THE FOUR OPEN DEMO CLAIMS
// ---------------------------------------------------------------------------
// Each one exists to produce a specific, checkable advisory outcome. The
// expected result is stated next to it so a broken rule is obvious rather than
// merely different.

// Accident a few days before filing on every claim, so FR-01e (delayed
// reporting, fires above 14 days) stays quiet and does not muddy the history
// signals these cases are meant to demonstrate.
const JUAN_FILED = NOW;
const MARIA_FILED = NOW;
const PEDRO_FILED = NOW;
const ANDREA_FILED = NOW;

export const SAMPLE_CLAIMS = [
  // CASE A — high frequency, high cumulative amount, repeated damage area.
  // Expect: NOT_CLEARED / HIGH, with FR-02a (12-month tier), FR-02c, FR-02d
  // and FR-02e all firing.
  demoClaim({
    id: 'DEMO-2026-0001',
    claimant: CLAIMANTS.juan,
    status: 'In Assessment',
    claimType: 'Own Damage',
    claimedAmount: 65000,
    recommendedPayout: 52000,
    createdAt: JUAN_FILED,
    isFlagged: true,
    flagSummary: '⚠️ Awaiting document verification',
    ocrData: ocrDataFor(CLAIMANTS.juan, {
      accidentDate: daysBefore(JUAN_FILED, 4),
      estimateDate: daysBefore(JUAN_FILED, 2),
      estimatedCost: 63000,
      // 'rear bumper' also appears on three of Juan's prior claims — this is
      // what FR-02e keys on, and it is the strongest history signal in the set
      // because it points at a repeating fact rather than a count.
      detectedParts: ['rear bumper', 'boot lid'],
      severity: 'Moderate',
      damageDescription: 'deformation to the rear bumper cover and boot lid, rear lamp cluster cracked'
    })
  }),

  // CASE B — the clean baseline. One old prior, modest amounts, estimate and
  // claimed amount consistent. Expect: CLEARED / LOW, no indicators.
  demoClaim({
    id: 'DEMO-2026-0002',
    claimant: CLAIMANTS.maria,
    status: 'In Assessment',
    claimType: 'Third-Party Property Damage',
    claimedAmount: 48000,
    recommendedPayout: 46000,
    createdAt: MARIA_FILED,
    flagSummary: '✓ No exceptions detected',
    ocrData: ocrDataFor(CLAIMANTS.maria, {
      accidentDate: daysBefore(MARIA_FILED, 3),
      estimateDate: daysBefore(MARIA_FILED, 1),
      // 48,000 claimed against a 46,000 estimate is a 4.3% gap — inside
      // FR-03b's 10% tolerance, so the rule is evaluated and passes rather
      // than being skipped. A CLEARED that was actually checked.
      estimatedCost: 46000,
      detectedParts: ['front bumper'],
      severity: 'Minor',
      damageDescription: 'scuffing to the front bumper cover, no panel deformation'
    })
  }),

  // CASE C — THE HIGH-RISK-BUT-NOT-FRAUD CASE. This is the most important claim
  // in the dataset. Pedro has filed five claims in five years, which is
  // elevated, but they are spread evenly, hit different parts of the car every
  // time, and none was ever denied. That is an unlucky or high-mileage driver,
  // not a repeat-claiming pattern.
  //
  // Expect: FR-02a fires and is then SUPPRESSED by the dispersion rule, leaving
  // the claim CLEARED with the suppression visible on screen. This case exists
  // specifically to prove the module does not treat frequency as fraud.
  demoClaim({
    id: 'DEMO-2026-0003',
    claimant: CLAIMANTS.pedro,
    status: 'In Assessment',
    claimType: 'Own Damage',
    claimedAmount: 33000,
    recommendedPayout: 31000,
    createdAt: PEDRO_FILED,
    flagSummary: '✓ No exceptions detected',
    ocrData: ocrDataFor(CLAIMANTS.pedro, {
      accidentDate: daysBefore(PEDRO_FILED, 6),
      estimateDate: daysBefore(PEDRO_FILED, 2),
      estimatedCost: 32000,
      // A part that appears on none of his prior claims, so FR-02e stays quiet
      // and the dispersion suppression is allowed to apply.
      detectedParts: ['left headlamp'],
      severity: 'Minor',
      damageDescription: 'cracked left headlamp housing and minor bumper scuffing'
    })
  }),

  // CASE D — zero history, but the repair estimate is wildly out of line with
  // the damage documented in the photographs. Expect: NOT_CLEARED / MODERATE on
  // FR-03a alone, proving the two rule families are independent.
  demoClaim({
    id: 'DEMO-2026-0004',
    claimant: CLAIMANTS.andrea,
    status: 'In Assessment',
    claimType: 'Own Damage',
    claimedAmount: 240000,
    recommendedPayout: 240000,
    createdAt: ANDREA_FILED,
    isFlagged: true,
    flagSummary: '⚠️ Estimate pending verification',
    ocrData: ocrDataFor(CLAIMANTS.andrea, {
      accidentDate: daysBefore(ANDREA_FILED, 5),
      estimateDate: daysBefore(ANDREA_FILED, 1),
      // 240,000 against damage documented as Minor (ceiling 60,000) = 4.0x.
      // Claimed amount equals the estimate exactly, so FR-03b does NOT fire —
      // this case must rest on FR-03a alone.
      estimatedCost: 240000,
      detectedParts: ['front left bumper cover'],
      severity: 'Minor',
      damageDescription: 'light scuffing and paint transfer on the front left bumper cover, no panel deformation'
    })
  })
];

// ---------------------------------------------------------------------------
// PRIOR CLAIM HISTORY
// ---------------------------------------------------------------------------
// Closed claims that exist only to be found by findClaimantHistory(). They are
// never opened in the UI. Every one carries the same assured_id_no as its
// claimant's open claim, which is the whole basis of the match.

function historicalClaim({ id, claimant, monthsBack, claimedAmount, approvedPayout, status, detectedParts, nameOnForm }) {
  const filed = monthsAgo(monthsBack);
  return demoClaim({
    id,
    claimant,
    status,
    claimType: 'Own Damage',
    claimedAmount,
    approvedPayout,
    recommendedPayout: approvedPayout,
    createdAt: filed,
    decidedAt: daysAfter(filed, 21),
    flagSummary: status === 'Denied' ? '✕ Claim denied' : '✓ Settled',
    ocrData: ocrDataFor(claimant, {
      accidentDate: daysBefore(filed, 4),
      estimateDate: daysBefore(filed, 2),
      estimatedCost: approvedPayout,
      detectedParts,
      severity: 'Moderate',
      damageDescription: 'historical claim — damage detail not retained',
      nameOnForm
    })
  });
}

export const HISTORICAL_CLAIMS = [
  // --- JUAN: four priors, clustered, with 'rear bumper' recurring ------------
  historicalClaim({
    id: 'DEMO-HIST-0001', claimant: CLAIMANTS.juan, monthsBack: 44,
    claimedAmount: 45000, approvedPayout: 43000, status: 'Completed',
    detectedParts: ['rear bumper', 'tail lamp']
  }),
  historicalClaim({
    id: 'DEMO-HIST-0002', claimant: CLAIMANTS.juan, monthsBack: 20,
    claimedAmount: 88000, approvedPayout: 81000, status: 'Completed',
    detectedParts: ['front bumper', 'bonnet'],
    // DELIBERATE MISSPELLING. Same government id, different name on the form.
    // If identity resolution ever regresses to matching on names, this claim
    // drops out of Juan's history, his count falls from 4 to 3, and the whole
    // advisory changes. That is the point — it is the demo that proves the
    // matching is doing real work. See verification test 3.
    nameOnForm: 'Jan Dela Cruz'
  }),
  historicalClaim({
    id: 'DEMO-HIST-0003', claimant: CLAIMANTS.juan, monthsBack: 11,
    claimedAmount: 72000, approvedPayout: 69000, status: 'Completed',
    detectedParts: ['rear bumper', 'rear quarter panel']
  }),
  historicalClaim({
    id: 'DEMO-HIST-0004', claimant: CLAIMANTS.juan, monthsBack: 5,
    claimedAmount: 105000, approvedPayout: 98000, status: 'Completed',
    detectedParts: ['rear bumper', 'boot lid']
  }),

  // --- MARIA: one old prior, nothing to see ---------------------------------
  historicalClaim({
    id: 'DEMO-HIST-0005', claimant: CLAIMANTS.maria, monthsBack: 40,
    claimedAmount: 30000, approvedPayout: 28000, status: 'Completed',
    detectedParts: ['wing mirror']
  }),

  // --- PEDRO: four priors, evenly dispersed, all different parts -------------
  // The gaps are ~14 months throughout and the most recent is 15 months back,
  // so no two of his claims (including the open one) fall within 12 months of
  // each other. That is precisely the condition the dispersion suppression
  // tests for.
  historicalClaim({
    id: 'DEMO-HIST-0006', claimant: CLAIMANTS.pedro, monthsBack: 57,
    claimedAmount: 18000, approvedPayout: 17000, status: 'Completed',
    detectedParts: ['left wing mirror']
  }),
  historicalClaim({
    id: 'DEMO-HIST-0007', claimant: CLAIMANTS.pedro, monthsBack: 43,
    claimedAmount: 26000, approvedPayout: 24000, status: 'Completed',
    detectedParts: ['front bumper']
  }),
  historicalClaim({
    id: 'DEMO-HIST-0008', claimant: CLAIMANTS.pedro, monthsBack: 29,
    claimedAmount: 35000, approvedPayout: 33000, status: 'Completed',
    detectedParts: ['windscreen']
  }),
  historicalClaim({
    id: 'DEMO-HIST-0009', claimant: CLAIMANTS.pedro, monthsBack: 15,
    claimedAmount: 22000, approvedPayout: 21000, status: 'Completed',
    detectedParts: ['rear door']
  })

  // Andrea Lim has no history on purpose — DEMO-2026-0004 must reach
  // NOT_CLEARED on the valuation rule alone.
];

// ---------------------------------------------------------------------------

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

  const all = [
    ...SAMPLE_CLAIMS.map(claim => ({ claim, kind: 'open' })),
    ...HISTORICAL_CLAIMS.map(claim => ({ claim, kind: 'history' }))
  ];

  for (const { claim, kind } of all) {
    const existing = await Claim.findOne({ id: claim.id });
    if (existing) {
      console.log(`  SKIP    ${claim.id}  (already exists — left untouched)`);
      skipped++;
      continue;
    }

    // Raw driver insert, NOT Claim.create(). Mongoose's timestamps would
    // overwrite createdAt with "now" and destroy the history. See the note at
    // the top of this file.
    await Claim.collection.insertOne(claim);

    const filed = claim.createdAt.toISOString().slice(0, 10);
    console.log(`  INSERT  ${claim.id.padEnd(16)} ${kind.padEnd(8)} filed ${filed}  ${claim.policyholder}`);
    inserted++;
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
  console.log(`The collection now holds ${await Claim.countDocuments()} claim(s).`);

  if (inserted > 0) {
    console.log('\nExpected advisory outcomes once the engine runs:');
    console.log('  DEMO-2026-0001  Juan Dela Cruz   NOT_CLEARED / HIGH      (frequency + amount + repeated part)');
    console.log('  DEMO-2026-0002  Maria Santos     CLEARED / LOW           (clean baseline)');
    console.log('  DEMO-2026-0003  Pedro Ramirez    CLEARED                 (frequency fired, then suppressed as dispersed)');
    console.log('  DEMO-2026-0004  Andrea Lim       NOT_CLEARED / MODERATE  (repair cost vs documented damage)');
  }

  await mongoose.disconnect();
  process.exit(0);
}

// Only run when executed directly, so the arrays above can be imported by test
// scripts without connecting to anything.
if (process.argv[1] && process.argv[1].endsWith('seedClaims.js')) {
  seed().catch((err) => {
    console.error('\nSeeding failed:', err.message);
    process.exit(1);
  });
}
