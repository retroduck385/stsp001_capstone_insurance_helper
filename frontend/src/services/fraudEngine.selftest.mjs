// services/fraudEngine.selftest.mjs
//
// Verifies the FR-01 engine against fixtures, with no browser, no Vite and no
// MongoDB. Run it from the repo root:
//
//     node frontend/src/services/fraudEngine.selftest.mjs
//
// It exits non-zero if any case fails, so it can go straight into CI later.
//
// The fixtures are the four demo claims from CLAUDE-CODE-PLAN-fraud-module.md,
// rewritten into the shape the live API actually returns: nested `ocrData`
// sections, `createdAt` as the filing date, and policy dates on the claim.
//
// This doubles as the worked example of the input contract — if you want to
// know what the engine expects, read a fixture.

import { runFraudCheck } from './fraudEngine.js';

const claimForm = { id: 'doc-1', documentType: 'Completed Motor Claim Form', title: 'Motor Claim Form' };
const policeReport = { id: 'doc-2', documentType: 'Police Report OR Notarized Affidavit / Facts of Accident', title: 'Police Report' };
const estimateDoc = { id: 'doc-3', documentType: 'Repair Estimate', title: 'Itemized Repair Estimate' };

const FIXTURES = [
  {
    name: '8891 — incident a year before inception, filed 370 days later',
    claim: {
      id: 'CLM-2026-8891',
      policyholder: 'Juan Dela Cruz',
      claimType: 'Own Damage',
      policyInceptionDate: '2026-01-15',
      policyExpiryDate: '2027-01-14',
      createdAt: '2026-02-02T02:00:00.000Z',
      documents: [claimForm],
      rules: [],
      ocrData: { motorClaimForm: { accident_date: '01/28/2025' } }
    },
    expect: { band: 'REFER', hits: ['FR-01a', 'FR-01e'], suppressed: [], score: 65 }
  },
  {
    name: '8892 — police report dated 36 days before the claim form says the loss happened',
    claim: {
      id: 'CLM-2026-8892',
      policyholder: 'Reign Batac',
      claimType: 'Third-Party Property Damage',
      policyInceptionDate: '2026-01-20',
      policyExpiryDate: '2027-01-19',
      createdAt: '2026-02-12T02:00:00.000Z',
      documents: [claimForm, policeReport],
      rules: [],
      ocrData: {
        motorClaimForm: { accident_date: '02/10/2026' },
        policeReportOrAffidavit: { reportDate: '2026-01-05T00:00:00.000Z' }
      }
    },
    expect: { band: 'REFER', hits: ['FR-01c', 'FR-01d'], suppressed: [], score: 55 }
  },
  {
    name: '8893 — everything consistent',
    claim: {
      id: 'CLM-2026-8893',
      policyholder: 'Roberto Tan',
      claimType: 'Third-Party Bodily Injury / Death',
      policyInceptionDate: '2025-08-01',
      policyExpiryDate: '2026-07-31',
      createdAt: '2026-03-06T02:00:00.000Z',
      documents: [claimForm],
      rules: [],
      ocrData: { motorClaimForm: { accident_date: '03/04/2026' } }
    },
    expect: { band: 'CLEAR', hits: [], suppressed: [], score: 0 }
  },
  {
    name: '8894 — 19-day delay during a typhoon, suppressed',
    claim: {
      id: 'CLM-2026-8894',
      policyholder: 'Maria Santos',
      claimType: 'Own Damage',
      policyInceptionDate: '2025-06-10',
      policyExpiryDate: '2026-06-09',
      createdAt: '2026-02-20T02:00:00.000Z',
      documents: [claimForm],
      rules: [{ type: 'red', title: 'Typhoon / Flood Damage Excluded', text: 'No Acts of Nature endorsement.' }],
      ocrData: { motorClaimForm: { accident_date: '02/01/2026', accident_weather: 'Typhoon, heavy flooding' } }
    },
    expect: { band: 'CLEAR', hits: [], suppressed: ['FR-01e'], score: 0 }
  },

  // --- the cases that matter for the LIVE system, where most fields are null ---
  {
    name: 'live claim with no policy period on file — must NOT silently pass',
    claim: {
      id: 'CLM-2026-9001',
      claimType: 'Own Damage',
      createdAt: '2026-03-01T02:00:00.000Z',
      documents: [claimForm],
      rules: [],
      ocrData: { motorClaimForm: { accident_date: '02/26/2026' } }
    },
    expect: { band: 'CLEAR', hits: [], suppressed: [], score: 0, skipped: ['FR-01a', 'FR-01b', 'FR-01c', 'FR-01d', 'FR-01f'] }
  },
  {
    name: 'live claim with nothing extracted yet — every rule reports NOT EVALUATED',
    claim: { id: 'CLM-2026-9002', createdAt: '2026-03-01T02:00:00.000Z', documents: [], rules: [], ocrData: {} },
    expect: { band: 'CLEAR', hits: [], suppressed: [], score: 0, skipped: ['FR-01a', 'FR-01b', 'FR-01c', 'FR-01d', 'FR-01e', 'FR-01f'] }
  },
  {
    name: 'repair estimate dated before the incident',
    claim: {
      id: 'CLM-2026-9003',
      createdAt: '2026-03-05T02:00:00.000Z',
      documents: [claimForm, estimateDoc],
      rules: [],
      ocrData: {
        motorClaimForm: { accident_date: '03/02/2026' },
        repairEstimate: { estimateDate: '2026-02-14T00:00:00.000Z' }
      }
    },
    // One hard hit at weight 40 lands in the VERIFY band (25-54), not REFER.
    expect: { band: 'VERIFY', hits: ['FR-01f'], suppressed: [], score: 40 }
  },
  {
    name: 'HITL correction wins over the extracted value',
    claim: {
      id: 'CLM-CORRECTED',
      policyInceptionDate: '2026-01-15',
      policyExpiryDate: '2027-01-14',
      createdAt: '2026-02-02T02:00:00.000Z',
      documents: [claimForm],
      rules: [],
      // Flat array shape, as the UI holds it after an adjuster edit: the OCR read
      // 2025, the adjuster corrected it to 2026, so FR-01a must no longer fire.
      ocrData: [
        {
          fieldId: 'accident_date',
          section: 'motorClaimForm',
          extractedValue: '01/28/2025',
          rawValue: '01/28/2025',
          correctedValue: '01/28/2026',
          sourceDoc: 'doc-1'
        }
      ]
    },
    expect: { band: 'CLEAR', hits: ['FR-01d'], suppressed: [], score: 15 }
  },
  {
    name: 'late filing declared on the form — delayed reporting suppressed',
    claim: {
      id: 'CLM-LATE-DECLARED',
      createdAt: '2026-03-20T02:00:00.000Z',
      documents: [claimForm],
      rules: [],
      ocrData: {
        motorClaimForm: {
          accident_date: '02/01/2026',
          reason_for_late_filing: 'Assured was confined in hospital until 15 March.'
        }
      }
    },
    expect: { band: 'CLEAR', hits: [], suppressed: ['FR-01e'], score: 0 }
  }
];

// ---------------------------------------------------------------------------

const codes = (list) => list.map(item => item.code).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());

let failures = 0;

for (const { name, claim, expect } of FIXTURES) {
  const result = runFraudCheck(claim);
  const problems = [];

  if (result.band !== expect.band) problems.push(`band ${result.band}, expected ${expect.band}`);
  if (expect.score !== undefined && result.score !== expect.score) {
    problems.push(`score ${result.score}, expected ${expect.score}`);
  }
  if (!same(codes(result.hits), expect.hits)) {
    problems.push(`hits [${codes(result.hits)}], expected [${[...expect.hits].sort()}]`);
  }
  if (!same(codes(result.suppressed), expect.suppressed)) {
    problems.push(`suppressed [${codes(result.suppressed)}], expected [${[...expect.suppressed].sort()}]`);
  }
  if (expect.skipped && !same(codes(result.skipped), expect.skipped)) {
    problems.push(`skipped [${codes(result.skipped)}], expected [${[...expect.skipped].sort()}]`);
  }

  // Guardrail 1, asserted rather than assumed: the engine must never emit a
  // payout-shaped field. If someone adds one, this fails loudly.
  const forbidden = ['approvedPayout', 'recommendedPayout', 'claimedAmount', 'payout'];
  const leaked = forbidden.filter(key => key in result);
  if (leaked.length) problems.push(`output leaked payout field(s): ${leaked}`);

  if (problems.length) {
    failures += 1;
    console.log(`FAIL  ${name}`);
    problems.forEach(p => console.log(`        ${p}`));
  } else {
    const detail = `${result.score} ${result.band}` +
      (result.hits.length ? ` · hits ${codes(result.hits).join(',')}` : '') +
      (result.suppressed.length ? ` · suppressed ${codes(result.suppressed).join(',')}` : '') +
      (result.skipped.length ? ` · not evaluated ${codes(result.skipped).join(',')}` : '');
    console.log(`ok    ${name}\n        ${detail}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${FIXTURES.length} fraud-engine cases passed.`
    : `\n${failures} of ${FIXTURES.length} cases FAILED.`
);

process.exit(failures === 0 ? 0 : 1);
