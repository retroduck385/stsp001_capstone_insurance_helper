// services/fraudEngine.js
//
// FR-01 — TEMPORAL INCONSISTENCY DETECTION
// =============================================================================
// A deterministic, rule-based integrity check. Given one claim, it returns a
// score, a band, and the evidence behind every signal it raised.
//
// This file is PURE. No React, no network, no imports from components, no
// reading of the clock beyond stamping `evaluatedAt`. That is deliberate: the
// whole module is meant to be liftable into a Python service later with a
// direct line-by-line translation, and to be testable from plain Node.
//
//
// ── THE INPUT CONTRACT ───────────────────────────────────────────────────────
// runFraudCheck(claim) expects a claim shaped like the ones GET /api/claims
// returns, after services/api.js has normalised it:
//
//   {
//     id: 'CLM-2026-9001',
//     policyholder: 'Juan Dela Cruz',
//     claimType: 'Own Damage',
//     claimedAmount: 65000,
//     createdAt: '2026-02-02T08:14:00.000Z',   // Mongo timestamp = date filed
//     documents: [ { id, title, documentType, ... } ],
//     rules: [ { type, title, text } ],
//     ocrData: [ { fieldId, section, extractedValue, correctedValue,
//                  rawValue, sourceDoc }, ... ]      ← flat array, OR
//     ocrData: { motorClaimForm: { accident_date: '...' }, ... }  ← nested
//   }
//
// Both ocrData shapes are accepted — the flat array is what the UI holds, the
// nested object is what MongoDB stores — so this can be called on either side
// of the adapter, and a future Python port can read the nested shape directly.
//
// Every ocrData-backed value is read as `correctedValue ?? rawValue ??
// extractedValue`, so an adjuster's HITL correction is always what gets
// evaluated. Correcting a date and re-running is the whole point of the module.
//
//
// ── THE OUTPUT CONTRACT ──────────────────────────────────────────────────────
//   {
//     score: 0-100,
//     band: 'CLEAR' | 'VERIFY' | 'REFER',
//     hits:      [ { code, label, category, severity, weight, detail, evidence } ],
//     suppressed:[ { code, label, detail, suppressionReason } ],
//     skipped:   [ { code, label, missing: ['policy inception date'] } ],
//     evaluatedAt: ISO string,
//     engineVersion: 'fraud-engine-0.1.0'
//   }
//
//
// ── NON-NEGOTIABLE GUARDRAILS (see CLAUDE-CODE-PLAN-fraud-module.md) ─────────
// 1. A fraud signal NEVER changes the payout. Nothing in this file reads or
//    writes approvedPayout / recommendedPayout. Its output only routes work.
// 2. The result lives in its own object and is never merged into claim.rules.
//    Policy rules mean "not covered". Integrity signals mean "needs checking".
//    Confusing the two is the single worst failure mode of a module like this.
// 3. No claimant-facing wording here. Adjuster-facing language only.
// 4. A hit with no evidence does not fire. Where an input is missing the rule
//    reports itself in `skipped` — it never quietly passes. An engine that
//    returns CLEAR because it had nothing to read is worse than no engine.
// 5. No demographic or proxy inputs. Nothing below reads name, address,
//    barangay, age, sex, nationality, occupation, or income — those fields
//    exist in ocrData and are deliberately untouched.
// =============================================================================

// The explicit .js extension is deliberate. Elsewhere in this codebase imports
// are extensionless because Vite resolves them, but this module is also meant
// to run under plain Node (see fraudEngine.selftest.mjs), and Node's ESM
// resolver requires the extension. Vite accepts it either way.
import { getPolicyPeriod } from '../data/policyRegister.js';

export const ENGINE_VERSION = 'fraud-engine-0.1.0';

/** score → band. The soft-only floor in runFraudCheck can override this. */
export const BAND_THRESHOLDS = [
  { band: 'CLEAR', min: 0, max: 24 },
  { band: 'VERIFY', min: 25, max: 54 },
  { band: 'REFER', min: 55, max: 100 }
];

/** One-line meaning of each band, for the UI and the referral packet. */
export const BAND_MEANING = {
  CLEAR: 'No integrity signals. Normal processing.',
  VERIFY: 'Verification required before approval.',
  REFER: 'Payout locked. Refer to Special Investigation Unit.'
};

// ---------------------------------------------------------------------------
// DATE HANDLING
// ---------------------------------------------------------------------------

/**
 * Parses the date formats this system actually contains, and no others.
 *
 *   'YYYY-MM-DD'                     ocrSchema isDate fields, policyRegister
 *   '2026-02-02T08:14:00.000Z'       Mongo Date fields, createdAt
 *   'MM/DD/YYYY'                     what the motor claim form asks for
 *   'MM-DD-YYYY'                     the same, typed with dashes
 *   Date object                      belt and braces
 *
 * Returns an ISO 'YYYY-MM-DD' string, or null when the value is absent or
 * unreadable. Null propagates all the way to `skipped` — an unparseable date
 * must never be treated as a passing one.
 *
 * Slash/dash dates are read as MONTH FIRST, because that is what the form
 * label says ("Date of Accident or Loss (MM/DD/YYYY)"). When the first part is
 * above 12 it cannot be a month, so it is read day-first instead.
 */
export function parseClaimDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return null;

  // ISO, with or without a time component.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (iso) return validIso(iso[1], iso[2], iso[3]);

  // MM/DD/YYYY or MM-DD-YYYY (and the day-first fallback).
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const [month, day] = first > 12 ? [second, first] : [first, second];
    return validIso(parts[3], String(month).padStart(2, '0'), String(day).padStart(2, '0'));
  }

  return null;
}

/** Rejects impossible dates like 2026-02-31 rather than letting Date roll them over. */
function validIso(year, month, day) {
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const rebuilt = date.toISOString().slice(0, 10);
  return rebuilt === `${year}-${month}-${day}` ? rebuilt : null;
}

/**
 * Whole days from isoA to isoB. Positive when B is later.
 * Both arguments are ISO 'YYYY-MM-DD' strings; returns null if either is null.
 *
 * A helper rather than a date library, so the Python port is `(b - a).days`.
 */
export function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** '2026-01-28' → '28 Jan 2026', for detail sentences an adjuster has to read. */
function formatDate(iso) {
  if (!iso) return 'unknown';
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

/** "1 day" / "37 days" — so no detail sentence ever reads "1 days". */
function pluralDays(n) {
  const count = Math.abs(n);
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

// ---------------------------------------------------------------------------
// READING THE CLAIM
// ---------------------------------------------------------------------------

/**
 * The ocrData fields this engine reads, and where each lives.
 *
 * Every id here is a real field in both backend/src/server.js's claimSchema and
 * frontend/src/data/ocrSchema.js. If a field is renamed there it must be
 * renamed here, or the rule that depends on it starts reporting NOT EVALUATED.
 */
const FIELD_MAP = {
  incidentDate: { section: 'motorClaimForm', fieldId: 'accident_date', source: 'claim form' },
  policeReportDate: { section: 'policeReportOrAffidavit', fieldId: 'reportDate', source: 'police report' },
  estimateDate: { section: 'repairEstimate', fieldId: 'estimateDate', source: 'repair estimate' },
  lateFilingReason: { section: 'motorClaimForm', fieldId: 'reason_for_late_filing', source: 'claim form' },
  accidentWeather: { section: 'motorClaimForm', fieldId: 'accident_weather', source: 'claim form' },
  incidentSummary: { section: 'policeReportOrAffidavit', fieldId: 'incidentSummary', source: 'police report' }
};

/**
 * Pulls one field out of the claim, whichever ocrData shape it is in.
 *
 * Returns { value, fieldId, section, sourceDoc, wasCorrected } or null when the
 * field is absent or empty. `sourceDoc` is the document id the UI needs in
 * order to scroll the left-hand viewer to the page the value came from.
 */
function readField(claim, key) {
  const spec = FIELD_MAP[key];
  if (!spec || !claim) return null;

  const { ocrData } = claim;
  let value = null;
  let sourceDoc = null;
  let wasCorrected = false;

  if (Array.isArray(ocrData)) {
    // The flat shape the UI holds. Match on section too where the item carries
    // one — `dateOfBirth` and `fullName` exist in more than one section, and a
    // bare fieldId match would pick whichever came first.
    const item = ocrData.find(
      entry => entry.fieldId === spec.fieldId && (!entry.section || entry.section === spec.section)
    );
    if (item) {
      // HITL wins, then the structured raw value, then the display string.
      value = item.correctedValue ?? item.rawValue ?? item.extractedValue;
      sourceDoc = item.sourceDoc || null;
      wasCorrected = item.correctedValue !== null && item.correctedValue !== undefined;
    }
  } else if (ocrData && typeof ocrData === 'object') {
    // The nested shape MongoDB stores.
    value = ocrData[spec.section]?.[spec.fieldId] ?? null;
    sourceDoc = documentIdForSection(claim, spec.section);
  }

  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;

  return { value, fieldId: spec.fieldId, section: spec.section, source: spec.source, sourceDoc, wasCorrected };
}

/**
 * Best-effort document id for a section, used only for the nested shape.
 *
 * The flat shape already carries sourceDoc per field (the adapter works it out
 * properly via sectionKeyForDocument). This is a deliberately small duplicate
 * of that logic so the engine stays free of UI imports and stays portable.
 */
function documentIdForSection(claim, sectionKey) {
  const keywords = {
    motorClaimForm: ['motor claim form', 'claim form'],
    policeReportOrAffidavit: ['police report', 'affidavit', 'facts of accident'],
    repairEstimate: ['repair estimate', 'estimate']
  }[sectionKey] || [];

  const match = (claim.documents || []).find(doc => {
    const haystack = `${doc.documentType || ''} ${doc.title || ''} ${doc.fileName || ''}`.toLowerCase();
    return keywords.some(k => haystack.includes(k));
  });

  return match ? match.id : null;
}

/** A parsed date field: everything readField gives, plus `iso`. Null if unusable. */
function readDate(claim, key) {
  const field = readField(claim, key);
  if (!field) return null;
  const iso = parseClaimDate(field.value);
  return iso ? { ...field, iso } : null;
}

/**
 * Builds the evaluation context — every input the rules are allowed to see.
 *
 * Assembled once and passed to every rule, so a rule cannot reach into the
 * claim for something this function did not deliberately expose. That is what
 * keeps guardrail 5 (no demographic inputs) enforceable by reading one
 * function rather than auditing every rule.
 */
export function buildFraudContext(claim) {
  const policy = getPolicyPeriod(claim);

  const incident = readDate(claim, 'incidentDate');
  const policeReport = readDate(claim, 'policeReportDate');
  const estimate = readDate(claim, 'estimateDate');

  // The claim record's creation timestamp is the date the claim was filed.
  // There is no separate `reportedDate` in the schema and this is the honest
  // stand-in: it is when the claim entered the system.
  const reportedIso = parseClaimDate(claim.createdAt);

  return {
    claimId: claim.id || null,
    claimType: claim.claimType || null,

    // --- dates, all ISO 'YYYY-MM-DD' or null ---
    incidentDate: incident?.iso || null,
    reportedDate: reportedIso,
    policyInceptionDate: parseClaimDate(policy.inception),
    policyExpiryDate: parseClaimDate(policy.expiry),
    policeReportDate: policeReport?.iso || null,
    estimateDate: estimate?.iso || null,

    // --- provenance, so every hit can cite where its value came from ---
    fields: {
      incidentDate: incident,
      policeReportDate: policeReport,
      estimateDate: estimate
    },

    // --- free text used only by suppression, never by scoring ---
    lateFilingReason: readField(claim, 'lateFilingReason')?.value || null,
    narrative: [
      readField(claim, 'accidentWeather')?.value,
      readField(claim, 'incidentSummary')?.value
    ].filter(Boolean).join(' | '),
    ruleText: (claim.rules || []).map(r => `${r.title || ''} ${r.text || ''}`).join(' | ')
  };
}

/** Evidence block shared by every rule. `claimed` is always the claim's own assertion. */
function evidence(field, claimedIso, comparedToIso, comparedToLabel) {
  return {
    fieldId: field?.fieldId || null,
    sourceDoc: field?.sourceDoc || null,
    claimed: claimedIso,
    claimedLabel: 'Incident date on the claim form',
    comparedTo: comparedToIso,
    comparedToLabel
  };
}

// ---------------------------------------------------------------------------
// PART A — THE RULE CATALOGUE
// ---------------------------------------------------------------------------
//
// severity 'hard' = a factual contradiction in the documents.
// severity 'soft' = a pattern worth noting that is innocent on its own. Soft
//                   signals can never escalate a claim by themselves; see the
//                   soft-only floor in runFraudCheck.
//
// `requires` lists the ctx keys the rule cannot work without. The runner checks
// it before calling evaluate, so no rule has to defend itself against nulls and
// no missing input can be mistaken for a clean result.

export const FRAUD_RULES = [
  {
    code: 'FR-01a',
    label: 'Incident Predates Policy Inception',
    category: 'Temporal Inconsistency',
    severity: 'hard',
    weight: 55,
    requires: [
      ['incidentDate', 'incident date'],
      ['policyInceptionDate', 'policy inception date']
    ],
    evaluate: (ctx) => {
      const gap = daysBetween(ctx.incidentDate, ctx.policyInceptionDate);
      if (gap === null || gap <= 0) return null;
      return {
        evidence: evidence(ctx.fields.incidentDate, ctx.incidentDate, ctx.policyInceptionDate, 'Policy inception date'),
        detail:
          `Incident date ${formatDate(ctx.incidentDate)} falls ${pluralDays(gap)} before policy ` +
          `inception on ${formatDate(ctx.policyInceptionDate)}. Damage may predate coverage.`
      };
    }
  },
  {
    code: 'FR-01b',
    label: 'Incident After Policy Expiry',
    category: 'Temporal Inconsistency',
    severity: 'hard',
    weight: 55,
    requires: [
      ['incidentDate', 'incident date'],
      ['policyExpiryDate', 'policy expiry date']
    ],
    evaluate: (ctx) => {
      const gap = daysBetween(ctx.policyExpiryDate, ctx.incidentDate);
      if (gap === null || gap <= 0) return null;
      return {
        evidence: evidence(ctx.fields.incidentDate, ctx.incidentDate, ctx.policyExpiryDate, 'Policy expiry date'),
        detail:
          `Incident date ${formatDate(ctx.incidentDate)} falls ${pluralDays(gap)} after the policy ` +
          `expired on ${formatDate(ctx.policyExpiryDate)}. Coverage may have lapsed before the loss.`
      };
    }
  },
  {
    code: 'FR-01c',
    label: 'Cross-Document Date Conflict',
    category: 'Temporal Inconsistency',
    severity: 'hard',
    weight: 40,
    requires: [
      ['incidentDate', 'incident date on the claim form'],
      ['policeReportDate', 'date on the police report / affidavit']
    ],
    evaluate: (ctx) => {
      const gap = daysBetween(ctx.incidentDate, ctx.policeReportDate);
      if (gap === null || gap === 0) return null;

      // A police report filed a day or two AFTER the incident is normal — that
      // is just how long it takes to get to a station. Only a report dated
      // BEFORE the incident, or long after it, is a genuine contradiction.
      if (gap > 0 && gap <= 3) return null;

      return {
        evidence: evidence(
          ctx.fields.policeReportDate,
          ctx.incidentDate,
          ctx.policeReportDate,
          'Date recorded on the police report / affidavit'
        ),
        detail:
          `Claim form states the loss occurred ${formatDate(ctx.incidentDate)}. The police report / ` +
          `affidavit is dated ${formatDate(ctx.policeReportDate)} — ` +
          (gap < 0
            ? `${pluralDays(gap)} BEFORE the stated incident. A report cannot predate the event it describes.`
            : `a discrepancy of ${pluralDays(gap)}.`)
      };
    }
  },
  {
    code: 'FR-01d',
    label: 'Policy Freshness',
    category: 'Temporal Inconsistency',
    severity: 'soft',
    weight: 15,
    requires: [
      ['incidentDate', 'incident date'],
      ['policyInceptionDate', 'policy inception date']
    ],
    evaluate: (ctx) => {
      const age = daysBetween(ctx.policyInceptionDate, ctx.incidentDate);
      if (age === null || age < 0 || age > 30) return null;
      return {
        evidence: evidence(ctx.fields.incidentDate, ctx.incidentDate, ctx.policyInceptionDate, 'Policy inception date'),
        detail:
          `Incident occurred ${pluralDays(age)} after policy inception on ` +
          `${formatDate(ctx.policyInceptionDate)}. Early-term losses warrant standard verification.`
      };
    }
  },
  {
    code: 'FR-01e',
    label: 'Delayed Reporting',
    category: 'Temporal Inconsistency',
    severity: 'soft',
    weight: 10,
    requires: [
      ['incidentDate', 'incident date'],
      ['reportedDate', 'date the claim was filed']
    ],
    evaluate: (ctx) => {
      const delay = daysBetween(ctx.incidentDate, ctx.reportedDate);
      if (delay === null || delay <= 14) return null;
      return {
        evidence: evidence(ctx.fields.incidentDate, ctx.incidentDate, ctx.reportedDate, 'Date the claim was filed'),
        detail:
          `Claim filed ${pluralDays(delay)} after the incident date of ${formatDate(ctx.incidentDate)}.`
      };
    }
  },
  {
    // An addition to the five rules in the plan document. It belongs to the same
    // FR-01 temporal family, needs no data the system does not already hold, and
    // it is one of the few signals that survives an adjuster correcting the
    // claim form — the estimate carries its own independent date.
    code: 'FR-01f',
    label: 'Repair Estimate Predates Incident',
    category: 'Temporal Inconsistency',
    severity: 'hard',
    weight: 40,
    requires: [
      ['incidentDate', 'incident date'],
      ['estimateDate', 'date on the repair estimate']
    ],
    evaluate: (ctx) => {
      const gap = daysBetween(ctx.estimateDate, ctx.incidentDate);
      if (gap === null || gap <= 0) return null;
      return {
        evidence: evidence(
          ctx.fields.estimateDate,
          ctx.incidentDate,
          ctx.estimateDate,
          'Date on the repair estimate'
        ),
        detail:
          `The repair estimate is dated ${formatDate(ctx.estimateDate)}, ${pluralDays(gap)} BEFORE the ` +
          `stated incident on ${formatDate(ctx.incidentDate)}. Damage may have been quoted before the loss occurred.`
      };
    }
  }
];

// ---------------------------------------------------------------------------
// PART B — SUPPRESSION
// ---------------------------------------------------------------------------
//
// Suppression is how the engine says "I saw this and decided not to raise it."
// A suppressed hit is never scored, and is never hidden either — the UI renders
// it so the adjuster can see what the system chose to let through. A silent
// suppression would be indistinguishable from a bug.

const NATURAL_PERIL = /typhoon|flood|storm|water ingress|submersion|bagyo|habagat|monsoon/i;
const AON_COVER = /acts of nature|\bAON\b/i;

export const SUPPRESSION_RULES = [
  {
    appliesTo: 'FR-01e',
    reason: 'Delayed reporting is expected during a declared natural peril event.',
    test: (ctx) => NATURAL_PERIL.test(ctx.narrative) || NATURAL_PERIL.test(ctx.ruleText) || AON_COVER.test(ctx.ruleText)
  },
  {
    appliesTo: 'FR-01e',
    // The motor claim form has a dedicated "Reason for Late Filing" box. When the
    // claimant has filled it in, the delay is declared rather than concealed, so
    // it stops being an integrity signal and becomes something to read. The
    // adjuster still sees the row, and still sees the stated reason.
    reason: 'Late filing was declared on the claim form.',
    test: (ctx) => Boolean(ctx.lateFilingReason && String(ctx.lateFilingReason).trim())
  }
];

// ---------------------------------------------------------------------------
// PART C — THE RUNNER
// ---------------------------------------------------------------------------

function bandForScore(score) {
  const match = BAND_THRESHOLDS.find(b => score >= b.min && score <= b.max);
  return match ? match.band : 'CLEAR';
}

/**
 * Runs the whole catalogue against one claim.
 *
 * Deterministic: the same claim always produces the same score and band. The
 * only non-deterministic value in the output is `evaluatedAt`.
 */
export function runFraudCheck(claim) {
  const evaluatedAt = new Date().toISOString();

  if (!claim) {
    return { score: 0, band: 'CLEAR', hits: [], suppressed: [], skipped: [], evaluatedAt, engineVersion: ENGINE_VERSION };
  }

  const ctx = buildFraudContext(claim);

  const hits = [];
  const suppressed = [];
  const skipped = [];

  for (const rule of FRAUD_RULES) {
    // Guardrail 4: a rule missing its inputs reports that it could not run.
    const missing = (rule.requires || [])
      .filter(([key]) => ctx[key] === null || ctx[key] === undefined)
      .map(([, label]) => label);

    if (missing.length > 0) {
      skipped.push({ code: rule.code, label: rule.label, severity: rule.severity, missing });
      continue;
    }

    const outcome = rule.evaluate(ctx);
    if (!outcome) continue;

    // Guardrail 4 again, from the other direction: no evidence, no hit.
    if (!outcome.evidence || (!outcome.evidence.fieldId && !outcome.evidence.sourceDoc && !outcome.evidence.claimed)) {
      continue;
    }

    const suppression = SUPPRESSION_RULES.find(s => s.appliesTo === rule.code && s.test(ctx));

    if (suppression) {
      suppressed.push({
        code: rule.code,
        label: rule.label,
        category: rule.category,
        severity: rule.severity,
        weight: rule.weight,
        detail: outcome.detail,
        evidence: outcome.evidence,
        suppressionReason: suppression.reason
      });
      continue;
    }

    hits.push({
      code: rule.code,
      label: rule.label,
      category: rule.category,
      severity: rule.severity,
      weight: rule.weight,
      detail: outcome.detail,
      evidence: outcome.evidence
    });
  }

  const score = Math.min(100, hits.reduce((total, hit) => total + hit.weight, 0));

  // THE SOFT-ONLY FLOOR.
  // If nothing harder than a soft signal fired, the band is forced to CLEAR no
  // matter what the weights add up to. Policy freshness plus a late filing is a
  // description of an ordinary claim, not a reason to hold someone's payout.
  // Escalation requires at least one factual contradiction in the documents.
  const hasHard = hits.some(hit => hit.severity === 'hard');
  const band = hits.length === 0 || !hasHard ? 'CLEAR' : bandForScore(score);

  return { score, band, hits, suppressed, skipped, evaluatedAt, engineVersion: ENGINE_VERSION };
}

/**
 * Convenience for the dashboard: is this claim one an adjuster must act on
 * before approving? Kept here so the threshold lives with the engine.
 */
export function needsIntegrityReview(result) {
  return Boolean(result) && (result.band === 'VERIFY' || result.band === 'REFER');
}
