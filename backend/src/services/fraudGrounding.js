// services/fraudGrounding.js
//
// DID THE MODEL MAKE THAT NUMBER UP?
// =============================================================================
// The guardrails elsewhere in this module make it structurally impossible for
// the reasoning model to change the advisory's state, add an indicator, see the
// claimant's identity, or read a claim the rules did not cite.
//
// None of that stops it misstating a figure in its prose.
//
// That gap is real and was observed in testing: the model wrote "cumulative
// history of PHP 375,000 across 4 prior claims". PHP 375,000 is the total across
// FIVE claims — the four priors plus the one under review. The sentence reads
// perfectly, sits in the panel an adjuster actually reads, and nothing in the
// system noticed.
//
// This file is the smallest honest response to that. After the model writes, it
// takes every currency figure and every claim id out of the text and asks a
// single question: was this value in the data the model was given? Anything that
// was not is marked on screen as untraceable.
//
//
// ── WHAT THIS CATCHES, AND WHAT IT DOES NOT ─────────────────────────────────
// READ THIS BEFORE CITING THE CHECK AS EVIDENCE OF ANYTHING.
//
// It catches FABRICATED values — a peso figure or a claim id that appears
// nowhere in the payload or the tool results. That is the failure mode where a
// model invents a number wholesale, and it is caught reliably.
//
// It does NOT catch MISRELATED values — two figures that are each individually
// real, combined into a false statement. The observed error above passes this
// check cleanly: 375,000 is in the data, 4 is in the data, and the check has no
// way to know that joining them is wrong. Detecting that requires verifying the
// SEMANTICS of a sentence against a data model, which is a different and much
// larger problem.
//
// So: a clean grounding result means "every figure here exists in the source
// data". It does not mean "this analysis is correct", and it must never be
// presented as if it did.

/**
 * Currency figures the model wrote: "₱240,000", "PHP 240,000", "PHP240000.50".
 * Bare numbers are deliberately not matched — see collectQuoted below.
 */
const CURRENCY_PATTERN = /(?:₱|PHP\s?)\s?([\d,]+(?:\.\d+)?)/gi;

/**
 * Claim ids: DEMO-2026-0001, DEMO-HIST-0003, CLM-2026-9001.
 * Two or more dash-separated groups, at least one of which is digits.
 */
const CLAIM_ID_PATTERN = /\b[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]{2,9}){1,3}\b/g;

/** Matches how currency is rendered everywhere else in the UI. */
function peso(value) {
  return `₱${Number(value).toLocaleString('en-PH')}`;
}

/** '240,000' → 240000. Returns null for anything unparseable. */
function toNumber(text) {
  const n = Number(String(text).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// GROUND TRUTH
// ---------------------------------------------------------------------------

/**
 * Walks any nested structure and collects every number and every claim-id-shaped
 * string in it.
 *
 * Used on both the prompt payload and each tool result, because a figure the
 * model learned from lookupPriorClaim is every bit as legitimately citable as
 * one from the opening prompt. Leaving the trail out would flag the agent's own
 * research as fabrication.
 */
function harvest(value, numbers, claimIds) {
  if (value === null || value === undefined) return;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) numbers.add(value);
    return;
  }

  if (typeof value === 'string') {
    for (const match of value.matchAll(CLAIM_ID_PATTERN)) claimIds.add(match[0]);
    for (const match of value.matchAll(CURRENCY_PATTERN)) {
      const n = toNumber(match[1]);
      if (n !== null) numbers.add(n);
    }
    // A bare numeric string, e.g. "105000" stored as text.
    const bare = toNumber(value);
    if (bare !== null && value.trim() !== '') numbers.add(bare);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) harvest(item, numbers, claimIds);
    return;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value)) harvest(item, numbers, claimIds);
  }
}

/**
 * Every subset sum of the known money values.
 *
 * WHY THIS IS NECESSARY, not defensive padding: the payload gives the model the
 * four prior claim amounts (45,000 / 88,000 / 72,000 / 105,000) and the
 * five-claim total (375,000). It does NOT give the four-prior subtotal of
 * 310,000. A model that correctly adds up the priors and writes "₱310,000 across
 * the four prior claims" would be flagged as fabricating — the check would fire
 * on the one thing we most want the model to do.
 *
 * Capped, because subset sums are exponential. Above the cap the sums are
 * skipped rather than the check being abandoned: the worst case is a false
 * "unsupported" on a derived figure, which is visible and correctable, whereas
 * hanging the advisory is not.
 */
const SUBSET_SUM_CAP = 14;

function withSubsetSums(numbers) {
  const money = [...numbers].filter(n => n >= 1000 && Number.isInteger(n));
  if (money.length === 0 || money.length > SUBSET_SUM_CAP) return numbers;

  const sums = new Set(numbers);
  // Iterative powerset: each value either joins an existing running total or
  // starts one. 2^14 is 16k operations, which is nothing.
  let running = [0];
  for (const value of money) {
    const next = running.slice();
    for (const total of running) next.push(total + value);
    running = next;
  }
  for (const total of running) if (total > 0) sums.add(total);

  return sums;
}

/**
 * Builds the set of values the model is entitled to cite.
 *
 * `payload` is what buildPromptPayload() sent; `trail` is every tool call it
 * made, including refused ones (a refusal carries the ids it was told about).
 */
export function collectGroundTruth(payload, trail = []) {
  const numbers = new Set();
  const claimIds = new Set();

  harvest(payload, numbers, claimIds);
  for (const step of trail) {
    harvest(step.args, numbers, claimIds);
    harvest(step.result, numbers, claimIds);
  }

  return { numbers: withSubsetSums(numbers), claimIds };
}

// ---------------------------------------------------------------------------
// THE CHECK
// ---------------------------------------------------------------------------

/** The sentence a value appeared in, so the adjuster can see it in context. */
function sentenceAround(text, index) {
  const start = text.lastIndexOf('.', index) + 1;
  const dot = text.indexOf('.', index);
  const end = dot === -1 ? text.length : dot + 1;
  return text.slice(start, end).trim();
}

/**
 * Checks one reasoning object against the facts the model was given.
 *
 * Returns { checked, verified, unsupported: [{ value, kind, context }],
 * counts: { currency, claimIds } }.
 *
 * NON-BLOCKING BY DESIGN. This annotates the analysis; it never withholds it.
 * A check whose only visible effect is the absence of something cannot be shown
 * to anyone, and a module that silently drops the AI section on one bad number
 * is harder to trust than one that shows the number and flags it.
 */
export function checkGrounding(reasoning, groundTruth) {
  if (!reasoning) return { checked: false, verified: false, unsupported: [] };

  const fields = [
    ['summary', reasoning.summary],
    ['reasoning', reasoning.reasoning],
    ['riskFraming', reasoning.riskFraming],
    ...(reasoning.suggestedChecks || []).map((text, i) => [`suggestedChecks[${i}]`, text])
  ].filter(([, text]) => typeof text === 'string' && text);

  const unsupported = [];
  const seen = new Set();
  let currencyCount = 0;
  let claimIdCount = 0;

  for (const [field, text] of fields) {
    for (const match of text.matchAll(CURRENCY_PATTERN)) {
      currencyCount++;
      const value = toNumber(match[1]);
      if (value === null || groundTruth.numbers.has(value)) continue;

      const key = `currency:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      unsupported.push({
        value: peso(value),
        kind: 'currency',
        field,
        context: sentenceAround(text, match.index)
      });
    }

    for (const match of text.matchAll(CLAIM_ID_PATTERN)) {
      const id = match[0];
      // Rule codes (FR-02e) and the like are not claim ids; only flag tokens
      // that look like a claim reference and were never mentioned.
      if (!/\d/.test(id) || id.length < 8) continue;
      claimIdCount++;
      if (groundTruth.claimIds.has(id)) continue;

      const key = `claim:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      unsupported.push({
        value: id,
        kind: 'claimId',
        field,
        context: sentenceAround(text, match.index)
      });
    }
  }

  return {
    checked: true,
    verified: unsupported.length === 0,
    unsupported,
    counts: { currency: currencyCount, claimIds: claimIdCount }
  };
}
