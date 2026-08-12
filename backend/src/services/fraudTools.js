// services/fraudTools.js
//
// THE TOOLS THE REASONING MODEL MAY CALL
// =============================================================================
// This is what makes the module agentic rather than a single-shot generation:
// the model decides what it needs to look at, asks for it, reads the answer,
// and may ask again before writing its analysis.
//
// What it does NOT get is any say in the outcome. Read that distinction
// carefully, because it is the entire design:
//
//   The model can INVESTIGATE.        It cannot DECIDE.
//
// Every tool below is read-only. None of them writes to Mongo, none returns a
// payout figure, none returns a name or an address, and nothing the model does
// here can add an indicator or change CLEARED / NOT_CLEARED — that was settled
// by the rule layer in fraudAdvisor.js before this file was ever reached.
//
//
// ── WHY THE TOOLS ARE FENCED, NOT OPEN ──────────────────────────────────────
// The obvious implementation is "give the model a claims lookup". That would be
// wrong. An unfenced lookup lets the model read any claim in the database,
// including claims belonging to people entirely unrelated to the one under
// review, on nothing but a hallucinated claim id. In a module whose output can
// send a real person for investigation, that is not an acceptable failure mode.
//
// So lookupPriorClaim is restricted to the claim ids the RULES ALREADY CITED.
// If a rule did not name a claim as evidence, the model cannot open it. The
// fence is enforced in this file, on every call, and a rejected call is
// recorded in the trail rather than hidden — see buildFraudTools below.
//
// This is the same discipline as fraudReasoner.js's allowlisted prompt payload,
// applied to the second channel through which data can now reach the model.

import { FRAUD_RULES } from './fraudRules/temporalRules.js';
import { HISTORY_RULES, WINDOW_DAYS, CUMULATIVE_AMOUNT_CEILING, HIGH_FREQUENCY_COUNT } from './fraudRules/historyRules.js';
import { VALUATION_RULES, SEVERITY_COST_BANDS, CLAIMED_OVER_ESTIMATE_TOLERANCE } from './fraudRules/valuationRules.js';

/**
 * What each rule actually tests, in one sentence, plus its numeric threshold.
 *
 * Kept beside the catalogues rather than inside them because this is
 * explanatory prose for a model, not logic. The codes are cross-checked against
 * the real catalogues at the bottom of this file, so a rule renamed or added
 * without a definition here surfaces as a warning instead of the model quietly
 * being told "no definition available".
 */
const RULE_TESTS = {
  'FR-01a': 'Compares the incident date on the claim form against the policy inception date. Fires when the loss is dated before cover began.',
  'FR-01b': 'Compares the incident date against the policy expiry date. Fires when the loss is dated after cover ended.',
  'FR-01c': 'Compares the incident date on the claim form against the date on the police report or affidavit. Fires when the report predates the incident at all, or postdates it by more than 3 days.',
  'FR-01d': 'Measures the gap between policy inception and the incident. Fires when the loss falls within 30 days of the policy starting.',
  'FR-01e': 'Measures the gap between the incident date and the date the claim was filed. Fires above 14 days.',
  'FR-01f': 'Compares the date on the repair estimate against the incident date. Fires when the estimate predates the loss it quotes.',
  'FR-02a': `Counts the claimant's claims, including this one, inside three nested windows. 3 or more in 12 months, or 3 or more in 24 months, or ${HIGH_FREQUENCY_COUNT} or more in 5 years, each raise an indicator. 3 to 4 in 5 years is an observation only.`,
  'FR-02b': `Measures the gap between consecutive claims. Fires when any two fall within ${WINDOW_DAYS.RAPID_SUCCESSION} days of each other.`,
  'FR-02c': `Sums claimedAmount across every claim in the 5-year window. Fires above PHP ${CUMULATIVE_AMOUNT_CEILING.toLocaleString('en-PH')}. This is an OBSERVATION and can never raise a warning on its own, because an expensive vehicle reaches this total on ordinary repairs.`,
  'FR-02d': 'Fires only when FR-02a raised an indicator AND FR-02c fired. It tests the combination, not either input, because repeat claiming together with high value means more than either alone.',
  'FR-02e': 'Compares the detected parts on this claim against the parts on each prior claim. Fires when the same part appears here and on 2 or more priors.',
  'FR-02f': 'Checks the status of every prior claim in the window. Fires when any was denied.',
  'FR-03a': `Compares the repair estimate against a cost ceiling for the damage severity read from the photographs: Minor PHP ${SEVERITY_COST_BANDS.minor.toLocaleString('en-PH')}, Moderate PHP ${SEVERITY_COST_BANDS.moderate.toLocaleString('en-PH')}, Severe has no ceiling and the rule does not fire. The severity is produced by an image model, not an inspector.`,
  'FR-03b': `Compares the claimed amount against the repair estimate. Fires when the claim exceeds the estimate by more than ${CLAIMED_OVER_ESTIMATE_TOLERANCE * 100}%.`
};

/** Severity meanings, so the model can explain what a classification implies. */
const SEVERITY_MEANING = {
  indicator: 'A pattern that justifies asking the agent to look closer. Indicators alone set the NOT_CLEARED state.',
  observation: 'A pattern worth noting. Never raises a warning on its own and never changes the state.',
  tiered: 'This rule reports either "indicator" or "observation" depending on which threshold was crossed. Check the severity on the signal you were given.',
  hard: 'A factual contradiction between documents. Maps to "indicator" in the advisory.',
  soft: 'A pattern that is innocent on its own. Maps to "observation" in the advisory.'
};

/** Every rule in the module, flattened for lookup. */
const ALL_RULES = [...FRAUD_RULES, ...HISTORY_RULES, ...VALUATION_RULES];

// ---------------------------------------------------------------------------
// THE DECLARATIONS SENT TO GEMINI
// ---------------------------------------------------------------------------
//
// Descriptions are written for the model, and they state the LIMITS as well as
// the capability. Telling it up front that lookupPriorClaim only accepts cited
// ids means it spends its turns usefully instead of guessing at ids and
// collecting rejections.

export const TOOL_DECLARATIONS = [
  {
    name: 'lookupPriorClaim',
    description:
      'Retrieve the details of ONE prior claim belonging to this same claimant. ' +
      'You may only look up claim ids that appear in the evidence of an indicator or ' +
      'observation you were given — you cannot browse the claims database. ' +
      'Returns the filing date, status, claimed amount and the vehicle parts detected on ' +
      'that claim. Returns no personal information about anyone.',
    parameters: {
      type: 'object',
      properties: {
        claimId: {
          type: 'string',
          description: 'The claim id, exactly as it appears in the evidence you were given, e.g. "DEMO-HIST-0003".'
        }
      },
      required: ['claimId']
    }
  },
  {
    name: 'listClaimDocuments',
    description:
      'List the documents currently on file for the claim under review. Use this to check ' +
      'whether a document exists before suggesting the agent compare it or request it — so ' +
      'that "obtain the police report" and "re-read the police report already on file" are ' +
      'never confused. Returns document types and titles only, not their contents.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'getRuleDefinition',
    description:
      'Retrieve what a specific rule actually tests and the threshold it uses. Use this ' +
      'before explaining why a rule fired, so your explanation describes the real test ' +
      'rather than an assumed one.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The rule code, e.g. "FR-02e".'
        }
      },
      required: ['code']
    }
  }
];

// ---------------------------------------------------------------------------
// THE FENCE
// ---------------------------------------------------------------------------

/**
 * Collects every claim id the rule layer actually cited as evidence.
 *
 * This is the whitelist lookupPriorClaim is checked against. Built from the
 * finished advisory, so it is exactly "the claims a rule named", and nothing
 * the model asserts can widen it.
 */
export function citedClaimIds(advisory) {
  const ids = new Set();

  const collect = (signal) => {
    const evidence = signal?.evidence;
    if (!evidence) return;
    for (const key of ['claimIds', 'priorClaimIds']) {
      for (const id of evidence[key] || []) ids.add(id);
    }
  };

  (advisory.indicators || []).forEach(collect);
  (advisory.observations || []).forEach(collect);
  (advisory.suppressed || []).forEach(collect);

  return ids;
}

/**
 * The fields a prior claim may expose to the model.
 *
 * Same restriction as claimantIdentity.js's history projection, restated here
 * because this is a second, independent path to the same data. Two locks on the
 * same door, neither trusting the other. Note the absence of policyholder,
 * email, any ocrData.motorClaimForm identity field, and approvedPayout.
 */
function priorClaimView(claim) {
  return {
    id: claim.id,
    filedDate: claim.createdAt ? new Date(claim.createdAt).toISOString().slice(0, 10) : null,
    decidedDate: claim.decidedAt ? new Date(claim.decidedAt).toISOString().slice(0, 10) : null,
    status: claim.status ?? null,
    claimType: claim.claimType ?? null,
    claimedAmount: claim.claimedAmount ?? null,
    detectedParts: claim.ocrData?.repairEstimate?.detectedParts ?? [],
    damageSeverity: claim.ocrData?.vehicleDamagePictures?.severity ?? null
  };
}

// ---------------------------------------------------------------------------
// THE EXECUTORS
// ---------------------------------------------------------------------------

/**
 * Builds the tool implementations for one advisory run.
 *
 * Returns { declarations, execute(name, args) }. `execute` never throws: a bad
 * tool name, a bad argument, a refused id or a database error all come back as
 * an object with an `error` string, which the model reads and works around. An
 * exception here would abort the whole reasoning turn over something the model
 * can simply be told about.
 */
export function buildFraudTools(ClaimModel, claim, advisory) {
  const allowed = citedClaimIds(advisory);

  const executors = {
    async lookupPriorClaim({ claimId } = {}) {
      if (!claimId || typeof claimId !== 'string') {
        return { error: 'claimId is required and must be a string.' };
      }

      // THE FENCE. A claim the rules did not cite cannot be opened, even if it
      // exists, and even if it belongs to this claimant. The model's job is to
      // explain the evidence it was given, not to go looking for more.
      if (!allowed.has(claimId)) {
        return {
          error:
            `"${claimId}" was not cited as evidence by any rule in this advisory, so it cannot be ` +
            `looked up. You may only examine: ${[...allowed].join(', ') || '(no prior claims were cited)'}.`
        };
      }

      const prior = await ClaimModel.findOne({ id: claimId }).lean();
      if (!prior) return { error: `No claim found with id "${claimId}".` };

      return priorClaimView(prior);
    },

    async listClaimDocuments() {
      const documents = claim?.documents || [];

      // documentType and title only. fileName is deliberately excluded — an
      // uploaded file is frequently named after the person it belongs to, and
      // guardrail 6 does not stop applying because the identity arrived via a
      // filename rather than a field.
      return {
        claimId: claim?.id ?? null,
        documentCount: documents.length,
        documents: documents.map(doc => ({
          documentType: doc.documentType ?? null,
          title: doc.title ?? null
        }))
      };
    },

    async getRuleDefinition({ code } = {}) {
      if (!code || typeof code !== 'string') {
        return { error: 'code is required and must be a string, e.g. "FR-02e".' };
      }

      const normalised = code.trim().toUpperCase().replace(/^FR-?/, 'FR-');
      const rule = ALL_RULES.find(entry => entry.code.toUpperCase() === normalised);

      if (!rule) {
        return {
          error: `No rule with code "${code}". The rules in this module are: ${ALL_RULES.map(r => r.code).join(', ')}.`
        };
      }

      return {
        code: rule.code,
        label: rule.label,
        category: rule.category,
        severity: rule.severity ?? 'unknown',
        severityMeaning: SEVERITY_MEANING[rule.severity] ?? 'This rule does not declare a fixed severity.',
        whatItTests: RULE_TESTS[rule.code] ?? 'No plain-language definition is recorded for this rule.',
        requires: (rule.requires || []).map(([, label]) => label)
      };
    }
  };

  return {
    declarations: TOOL_DECLARATIONS,

    /** Runs one tool call. Always resolves; never throws. */
    async execute(name, args) {
      const fn = executors[name];
      if (!fn) {
        return { error: `There is no tool called "${name}". Available: ${Object.keys(executors).join(', ')}.` };
      }
      try {
        return await fn(args || {});
      } catch (err) {
        console.error(`[fraudTools] ${name} failed:`, err.message);
        return { error: `The ${name} tool failed: ${err.message}` };
      }
    }
  };
}

// A rule whose plain-language definition was never written would leave the
// model guessing at what it tests — exactly the thing getRuleDefinition exists
// to prevent. Surface the gap at startup rather than at inference time.
const undocumented = ALL_RULES.filter(rule => !RULE_TESTS[rule.code]).map(rule => rule.code);
if (undocumented.length > 0) {
  console.warn(`[fraudTools] no definition recorded for: ${undocumented.join(', ')} — add them to RULE_TESTS.`);
}
