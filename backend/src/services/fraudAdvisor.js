// services/fraudAdvisor.js
//
// THE ORCHESTRATOR
// =============================================================================
// Runs all three rule families against one claim, merges their output into a
// single advisory, decides Cleared / Not Cleared, and — only when there is
// something to explain — asks the AI to write the reasoning.
//
//   temporalRules.js   FR-01  dates the claim asserts, checked against each other
//   historyRules.js    FR-02  the claimant's own prior claims
//   valuationRules.js  FR-03  repair cost against the documented damage
//
//
// ── WHAT REPLACED THE SCORE ─────────────────────────────────────────────────
// The previous design produced a 0-100 score and three bands, the worst of
// which locked the payout. Both are gone. What is left is a binary state and a
// concern level, and the difference between them matters:
//
//   state    'CLEARED' / 'NOT_CLEARED'.  Is there anything here the agent should
//            look at before approving? That is the entire question this module
//            is entitled to answer.
//
//   concern  'LOW' / 'MODERATE' / 'HIGH'. Used ONLY to order a queue of claims
//            for triage. It is not a severity of suspicion, it is not shown as
//            a verdict, and nothing in the system may act on it.
//
// There is no number, because a number invites being read as a measurement.
// "Fraud score: 72" reads as a property of the claimant. "Three indicators
// found, recommended for your review" reads as what it is — a work item.
//
//
// ── GUARDRAIL 5: THE AI EXPLAINS, THE RULES DECIDE ──────────────────────────
// `state` and `concern` are computed below, from the deterministic rule output,
// BEFORE the reasoner is called. The AI receives a finished advisory and adds
// prose to it. It cannot change the state, cannot add an indicator, and cannot
// remove one. If it fails entirely, everything above still stands.

import { evaluateTemporalRules } from './fraudRules/temporalRules.js';
import { evaluateHistoryRules } from './fraudRules/historyRules.js';
import { evaluateValuationRules } from './fraudRules/valuationRules.js';
import { findClaimantHistory } from './claimantIdentity.js';
import { generateFraudReasoning } from './fraudReasoner.js';

export const ADVISOR_VERSION = 'fraud-advisor-1.0.0';

/**
 * FR-01 still speaks in 'hard' / 'soft'. The advisory speaks in 'indicator' /
 * 'observation'. The mapping lives here so temporalRules.js needs no knowledge
 * of the advisory vocabulary and can stay portable.
 *
 * 'hard' means a factual contradiction between two documents, which is exactly
 * the kind of thing that justifies asking an agent to look closer — so it maps
 * to 'indicator'. 'soft' means a pattern that is innocent on its own, which is
 * the definition of an observation.
 */
const SEVERITY_MAP = { hard: 'indicator', soft: 'observation' };

function toAdvisorySeverity(severity) {
  return SEVERITY_MAP[severity] || severity;
}

/** Codes whose presence alone lifts concern to HIGH — see CONCERN below. */
const HIGH_CONCERN_CODES = new Set(['FR-02e', 'FR-02f']);

/**
 * One plain sentence for the agent, generated from the rule output.
 *
 * NOT written by the AI, deliberately. The headline is the first and sometimes
 * the only thing an agent reads, so it has to be a mechanical restatement of
 * what the rules found. A generated headline could drift into a claim the rules
 * never made, and it would do so in the most prominent line on the card.
 */
function buildHeadline(state, indicators) {
  if (state === 'CLEARED' || indicators.length === 0) {
    return 'No fraud indicators found. Normal processing.';
  }

  const count = indicators.length;
  return `${count} potential fraud indicator${count === 1 ? '' : 's'} found. ` +
    'Recommended for your review before approval.';
}

/**
 * Builds the complete advisory for one claim.
 *
 * `ClaimModel` is the Mongoose model, needed only so the history lookup can
 * query for the claimant's other claims.
 */
export async function buildFraudAdvisory(ClaimModel, claim) {
  const evaluatedAt = new Date().toISOString();

  // 1. GATHER. History first, since FR-02 is the only family that needs I/O.
  //    A failed lookup must not take the whole advisory down with it — the
  //    temporal and valuation rules can still say something useful, and the
  //    history rules will report themselves as not evaluated.
  let history = { key: null, basis: null, confidence: null, claims: [], windowYears: 5 };
  let historyError = null;
  try {
    history = await findClaimantHistory(ClaimModel, claim);
  } catch (err) {
    historyError = err.message;
    console.error(`Claimant history lookup failed for ${claim?.id}:`, err.message);
  }

  // 2. EVALUATE.
  const temporal = evaluateTemporalRules(claim);
  const historyResult = evaluateHistoryRules(claim, history);
  const valuation = evaluateValuationRules(claim);

  const allFired = [
    ...temporal.fired.map(hit => ({ ...hit, severity: toAdvisorySeverity(hit.severity) })),
    ...historyResult.fired,
    ...valuation.fired
  ];

  const suppressed = [
    ...temporal.suppressed.map(hit => ({ ...hit, severity: toAdvisorySeverity(hit.severity) })),
    ...historyResult.suppressed,
    ...valuation.suppressed
  ];

  const skipped = [...temporal.skipped, ...historyResult.skipped, ...valuation.skipped];

  // A history lookup that threw is not the same as a claimant with no history,
  // and the advisory must not present it as one.
  if (historyError) {
    skipped.push({
      code: 'FR-02',
      label: 'Claim History (all rules)',
      category: 'Claim History',
      missing: [`the claimant's prior claims could not be read: ${historyError}`]
    });
  }

  const indicators = allFired.filter(hit => hit.severity === 'indicator');
  const observations = allFired.filter(hit => hit.severity !== 'indicator');

  // 3. STATE. This is the whole contract, and it is deliberately this simple:
  //    NOT_CLEARED if and only if at least one unsuppressed indicator fired.
  //    Observations never change it. A module whose state depended on a
  //    weighted sum would be making a quantitative claim it cannot support.
  const state = indicators.length > 0 ? 'NOT_CLEARED' : 'CLEARED';

  // 4. CONCERN. Triage ordering only. FR-02e (the same panel claimed again and
  //    again) and FR-02f (a prior denial) lift this on their own because both
  //    point at a specific verifiable fact rather than at a count.
  let concern = 'LOW';
  if (indicators.length === 1) concern = 'MODERATE';
  if (indicators.length >= 2 || indicators.some(hit => HIGH_CONCERN_CODES.has(hit.code))) {
    concern = 'HIGH';
  }

  const totalClaimed = (history.claims || []).reduce(
    (sum, prior) => sum + (Number(prior.claimedAmount) || 0),
    Number(claim?.claimedAmount) || 0
  );

  const advisory = {
    state,
    concern,
    headline: buildHeadline(state, indicators),
    indicators,
    observations,
    suppressed,
    skipped,
    history: {
      key: history.key,
      basis: history.basis,
      confidence: history.confidence,
      windowYears: history.windowYears,
      claimCount: (history.claims || []).length,
      totalClaimed
    },
    ai: null,
    evaluatedAt,
    engineVersion: ADVISOR_VERSION
  };

  // 5. EXPLAIN — only when there is something to explain. A CLEARED advisory
  //    has no indicators for the AI to reason about, so calling it would burn
  //    quota to produce a paragraph saying nothing happened.
  //
  //    Note what is passed and when. The advisory handed over is COMPLETE:
  //    state, concern and indicators are all settled above, and the reasoner
  //    receives them as facts to explain. It is also given the model and the
  //    claim, but only so its tools can read — lookupPriorClaim is fenced to
  //    the claim ids the rules cited, and no tool writes anything. The agent
  //    investigates; it does not decide. See fraudTools.js.
  if (state === 'NOT_CLEARED') {
    advisory.ai = await generateFraudReasoning(
      advisory,
      {
        claimType: claim?.claimType || null,
        claimedAmount: claim?.claimedAmount ?? null
      },
      { ClaimModel, claim }
    );
  }

  return advisory;
}
