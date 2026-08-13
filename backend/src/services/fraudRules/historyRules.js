// services/fraudRules/historyRules.js
//
// FR-02 — CLAIM HISTORY SIGNALS
// =============================================================================
// Reads the claimant's own prior claims (gathered by claimantIdentity.js) and
// reports patterns worth an agent's attention. Frequency is the primary signal;
// amount is secondary and mostly acts as a compounder.
//
//
// ── SEVERITY MEANS SOMETHING DIFFERENT HERE, READ THIS FIRST ─────────────────
//
//   'observation'  A pattern worth noting. NEVER raises a warning on its own.
//   'indicator'    A pattern that justifies asking the agent to look closer.
//
// There is no severity that means "fraud", and that omission is the whole
// design. The primary signal in this file is claim frequency, and frequency
// cannot support a fraud determination:
//
//   A policyholder with four legitimate claims arising from four separate,
//   verifiable events is a HIGH-RISK customer. That is not fraud. Fraud
//   requires intentional deception for financial gain, and nothing in a count
//   of claims can establish intent.
//
// Frequency is a trigger for investigation — which is exactly how carriers use
// contributory claim databases. It is an input to a human decision, never the
// decision. Every detail string below is written to that register: it says what
// is worth verifying, never what happened.
//
//
// ── THE OLD FR-01 SEVERITIES MAP ONTO THESE ─────────────────────────────────
// temporalRules.js still uses 'hard' / 'soft'. fraudAdvisor.js maps 'hard' →
// 'indicator' and 'soft' → 'observation' on the way in, so the two catalogues
// produce one vocabulary without either file having to know about the other.

/** Days in the windows the rules ask about. Named so they can be cited and tuned. */
export const WINDOW_DAYS = {
  RAPID_SUCCESSION: 90,
  TWELVE_MONTHS: 365,
  TWENTY_FOUR_MONTHS: 730
};

/** Cumulative claimed amount, in PHP, above which FR-02c notes the total. */
export const CUMULATIVE_AMOUNT_CEILING = 250000;

/** Claims inside the 5-year window at or above which frequency alone is an indicator. */
export const HIGH_FREQUENCY_COUNT = 5;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days between two Dates, always positive. */
function daysApart(a, b) {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / DAY_MS));
}

/** '3 Feb 2025' — detail sentences an agent has to read, not ISO strings. */
function formatDate(value) {
  const date = toDate(value);
  if (!date) return 'unknown';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** '₱310,000' — matches the currency convention used across the UI. */
function peso(amount) {
  return `₱${Number(amount || 0).toLocaleString('en-PH')}`;
}

/** Part names are compared lowercase and trimmed; anything else is a false negative. */
function normalisePart(part) {
  return String(part || '').toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// THE CONTEXT
// ---------------------------------------------------------------------------

/**
 * Assembles everything the history rules are allowed to see, once.
 *
 * Same discipline as buildFraudContext in temporalRules.js: a rule cannot reach
 * past this function into the claim, so guardrail 6 stays enforceable by
 * reading one function rather than auditing six rules.
 */
export function buildHistoryContext(claim, history) {
  const filedDate = toDate(claim?.createdAt);

  // The subject claim and its priors, treated as one timeline. Frequency is a
  // question about the claimant's whole record, and leaving the claim under
  // review out of its own count would understate every window.
  const timeline = [
    ...(filedDate ? [{ id: claim.id, filedDate, isSubject: true, status: claim.status, claimedAmount: claim.claimedAmount }] : []),
    ...(history?.claims || [])
      .map(prior => ({
        id: prior.id,
        filedDate: toDate(prior.createdAt),
        isSubject: false,
        status: prior.status,
        claimedAmount: prior.claimedAmount,
        decidedAt: prior.decidedAt,
        parts: (prior.detectedParts || []).map(normalisePart).filter(Boolean)
      }))
      .filter(prior => prior.filedDate)
  ].sort((a, b) => b.filedDate - a.filedDate);

  return {
    claimId: claim?.id || null,
    filedDate,
    claimedAmount: typeof claim?.claimedAmount === 'number' ? claim.claimedAmount : null,
    currentParts: (claim?.ocrData?.repairEstimate?.detectedParts || []).map(normalisePart).filter(Boolean),

    identityKey: history?.key ?? null,
    identityBasis: history?.basis ?? null,
    windowYears: history?.windowYears ?? null,
    priors: timeline.filter(entry => !entry.isSubject),
    timeline
  };
}

/** Claims in the timeline filed within `days` of now. */
function countWithin(ctx, days) {
  const cutoff = Date.now() - days * DAY_MS;
  return ctx.timeline.filter(entry => entry.filedDate.getTime() >= cutoff).length;
}

// ---------------------------------------------------------------------------
// THE RULES
// ---------------------------------------------------------------------------
//
// Each returns null (did not fire) or { severity, detail, evidence }. The
// OUTCOME's severity is what the runner uses, because FR-02a's tiers differ in
// what they justify — see the note on that rule.
//
// The `severity` declared on the rule object itself is documentation: it is what
// getRuleDefinition() in fraudTools.js reports to the reasoning model when it
// asks what a rule means. FR-02a is declared 'tiered' because it genuinely
// varies; every other rule here always returns the severity it declares.

export const HISTORY_RULES = [
  {
    code: 'FR-02a',
    label: 'Elevated Claim Frequency',
    category: 'Claim History',
    severity: 'tiered',
    requires: [
      ['filedDate', 'the date this claim was filed'],
      ['identityKey', 'an identifier to match the claimant on']
    ],
    /**
     * Tiered, because "five claims in five years" and "three claims in twelve
     * months" are not the same statement and must not produce the same wording.
     *
     * A note on the 5-year tier: the source plan wrote it as an observation
     * only. That left the dispersion suppression below with nothing to do —
     * three claims inside 24 months means, by the pigeonhole principle, two of
     * them fall within 12 months of each other, so an indicator-level frequency
     * hit can never satisfy the dispersion test. Splitting the 5-year tier at
     * HIGH_FREQUENCY_COUNT gives the suppression a real case to act on, which
     * is the behaviour the module is supposed to demonstrate.
     */
    evaluate: (ctx) => {
      const count12 = countWithin(ctx, WINDOW_DAYS.TWELVE_MONTHS);
      const count24 = countWithin(ctx, WINDOW_DAYS.TWENTY_FOUR_MONTHS);
      const countWindow = ctx.timeline.length;

      const ids = ctx.priors.map(prior => prior.id);
      const base = { priorClaimIds: ids, windowYears: ctx.windowYears };

      if (count12 >= 3) {
        return {
          severity: 'indicator',
          tier: '12_months',
          evidence: { ...base, windowMonths: 12, count: count12 },
          detail:
            `${count12} claims from this claimant in the last 12 months, including this one. ` +
            `A concentration this tight is uncommon and is worth verifying against the ` +
            `underlying incidents before approval.`
        };
      }

      if (count24 >= 3) {
        return {
          severity: 'indicator',
          tier: '24_months',
          evidence: { ...base, windowMonths: 24, count: count24 },
          detail:
            `${count24} claims from this claimant in the last 24 months, including this one. ` +
            `Worth checking that each relates to a separate, documented incident.`
        };
      }

      if (countWindow >= HIGH_FREQUENCY_COUNT) {
        return {
          severity: 'indicator',
          tier: 'five_years_high',
          evidence: { ...base, windowMonths: (ctx.windowYears || 5) * 12, count: countWindow },
          detail:
            `${countWindow} claims from this claimant in the last ${ctx.windowYears} years, including this one. ` +
            `That is an elevated claim rate. It is a reason to look, not a finding in itself — ` +
            `a high-mileage or commercially-used vehicle can produce this pattern legitimately.`
        };
      }

      if (countWindow >= 3) {
        return {
          severity: 'observation',
          tier: 'five_years',
          evidence: { ...base, windowMonths: (ctx.windowYears || 5) * 12, count: countWindow },
          detail:
            `${countWindow} claims from this claimant in the last ${ctx.windowYears} years, including this one. ` +
            `Noted for context only — this rate is within the range of ordinary motor claiming.`
        };
      }

      return null;
    }
  },

  {
    code: 'FR-02b',
    label: 'Rapid Succession',
    category: 'Claim History',
    severity: 'indicator',
    requires: [
      ['filedDate', 'the date this claim was filed'],
      ['identityKey', 'an identifier to match the claimant on']
    ],
    evaluate: (ctx) => {
      // Nearest pair anywhere in the timeline, not just against the current
      // claim — two priors filed a fortnight apart is the same signal.
      for (let i = 0; i < ctx.timeline.length - 1; i++) {
        const newer = ctx.timeline[i];
        const older = ctx.timeline[i + 1];
        const gap = daysApart(newer.filedDate, older.filedDate);

        if (gap <= WINDOW_DAYS.RAPID_SUCCESSION) {
          return {
            severity: 'indicator',
            evidence: {
              priorClaimIds: [newer.id, older.id],
              gapDays: gap,
              filedDates: [formatDate(newer.filedDate), formatDate(older.filedDate)]
            },
            detail:
              `Claims ${newer.id} and ${older.id} were filed ${gap} day${gap === 1 ? '' : 's'} apart ` +
              `(${formatDate(older.filedDate)} and ${formatDate(newer.filedDate)}). Confirm the two ` +
              `relate to distinct incidents and that no damage is being claimed twice.`
          };
        }
      }
      return null;
    }
  },

  {
    code: 'FR-02c',
    label: 'Elevated Cumulative Amount',
    category: 'Claim History',
    severity: 'observation',
    requires: [
      ['claimedAmount', 'the amount claimed'],
      ['identityKey', 'an identifier to match the claimant on']
    ],
    /**
     * An OBSERVATION and nothing more. A large total over five years may simply
     * mean an expensive vehicle, and the detail text has to say so — otherwise
     * this rule reads as an accusation about a number that has an entirely
     * ordinary explanation.
     */
    evaluate: (ctx) => {
      const total = ctx.timeline.reduce((sum, entry) => sum + (Number(entry.claimedAmount) || 0), 0);
      if (total <= CUMULATIVE_AMOUNT_CEILING) return null;

      return {
        severity: 'observation',
        evidence: {
          total,
          ceiling: CUMULATIVE_AMOUNT_CEILING,
          priorClaimIds: ctx.priors.map(prior => prior.id)
        },
        detail:
          `${peso(total)} claimed in total across ${ctx.timeline.length} claims in the last ` +
          `${ctx.windowYears} years, above the ${peso(CUMULATIVE_AMOUNT_CEILING)} reference point. ` +
          `On its own this means little — an expensive vehicle reaches this total on ordinary ` +
          `repairs. It is recorded here as context for the other signals.`
      };
    }
  },

  {
    code: 'FR-02d',
    label: 'Frequency Combined With Amount',
    category: 'Claim History',
    severity: 'indicator',
    requires: [
      ['filedDate', 'the date this claim was filed'],
      ['claimedAmount', 'the amount claimed'],
      ['identityKey', 'an identifier to match the claimant on']
    ],
    /**
     * The compound rule. Depends on FR-02a and FR-02c, so it is evaluated by
     * the runner below with their outcomes passed in rather than by re-deriving
     * them here — two places computing the same tier would eventually disagree.
     */
    dependsOn: ['FR-02a', 'FR-02c'],
    evaluate: (ctx, { frequency, cumulative } = {}) => {
      if (!frequency || frequency.severity !== 'indicator' || !cumulative) return null;

      return {
        severity: 'indicator',
        evidence: {
          frequency: frequency.evidence,
          cumulative: cumulative.evidence,
          priorClaimIds: ctx.priors.map(prior => prior.id)
        },
        detail:
          `Repeat claiming and high cumulative value are present together: ${frequency.evidence.count} ` +
          `claims in ${frequency.evidence.windowMonths} months, totalling ${peso(cumulative.evidence.total)}. ` +
          `Either alone has a routine explanation. The two in combination is what makes this worth ` +
          `a closer look, because it is the pattern that a single unlucky year does not produce.`
      };
    }
  },

  {
    code: 'FR-02e',
    label: 'Repeated Damage Area',
    category: 'Claim History',
    severity: 'indicator',
    requires: [
      ['currentParts', 'the parts listed on this claim\'s repair estimate'],
      ['identityKey', 'an identifier to match the claimant on']
    ],
    /**
     * The strongest history signal in the set. Unlike a frequency count, this
     * points at a specific repeating FACT — the same panel, claimed again and
     * again — which is something the agent can go and verify against the
     * photographs and the prior settlement records.
     */
    evaluate: (ctx) => {
      for (const part of ctx.currentParts) {
        const matching = ctx.priors.filter(prior => (prior.parts || []).includes(part));
        if (matching.length >= 2) {
          const ids = matching.map(prior => prior.id);
          return {
            severity: 'indicator',
            evidence: { part, claimIds: ids, occurrences: matching.length + 1 },
            detail:
              `"${part}" appears on this claim and on ${matching.length} prior claims ` +
              `(${ids.join(', ')}). Check whether the earlier repairs were completed and ` +
              `whether this is fresh damage to the same area.`
          };
        }
      }
      return null;
    }
  },

  {
    code: 'FR-02f',
    label: 'Prior Denied Claim',
    category: 'Claim History',
    severity: 'indicator',
    requires: [
      ['identityKey', 'an identifier to match the claimant on']
    ],
    evaluate: (ctx) => {
      const denied = ctx.priors.filter(prior => prior.status === 'Denied');
      if (denied.length === 0) return null;

      const ids = denied.map(prior => prior.id);
      return {
        severity: 'indicator',
        evidence: {
          claimIds: ids,
          decidedAt: denied.map(prior => (prior.decidedAt ? formatDate(prior.decidedAt) : null))
        },
        detail:
          `${denied.length} prior claim${denied.length === 1 ? ' was' : 's were'} denied ` +
          `(${ids.join(', ')}). Read the earlier denial reason before deciding this one — ` +
          `a previous denial may be unrelated, or may bear directly on the same question.`
      };
    }
  }
];

// ---------------------------------------------------------------------------
// SUPPRESSION
// ---------------------------------------------------------------------------

/**
 * DISPERSION SUPPRESSION — the false-positive control, and the reason Pedro
 * Ramirez comes back CLEARED.
 *
 * This rule exists specifically to stop the module treating an unlucky driver
 * as a suspect.
 *
 * A claimant can trip the frequency rule simply by driving a great deal. What
 * distinguishes that from a repeat-claiming pattern is not the count — it is
 * whether the claims cluster and whether anything repeats between them. So when
 * the claims are spread out, hit different parts of the vehicle every time, and
 * none was ever denied, the frequency signal is withdrawn and the reason is
 * shown on screen.
 *
 * Suppression is never silent. A suppressed signal is rendered in the advisory
 * card exactly so the agent can see what the system decided NOT to raise; a
 * hidden suppression would be indistinguishable from a bug.
 */
export const HISTORY_SUPPRESSIONS = [
  {
    appliesTo: 'FR-02a',
    reason:
      'Claims are dispersed across the period with no repeating pattern. Consistent with a ' +
      'high-mileage or high-exposure policyholder rather than a repeat-claiming pattern.',
    test: (ctx, fired) => {
      // Any repeating damage area, or any prior denial, means the pattern is
      // not merely "an unlucky driver" and the frequency signal stands.
      if (fired.has('FR-02e') || fired.has('FR-02f')) return false;

      // Every consecutive pair must be more than twelve months apart.
      for (let i = 0; i < ctx.timeline.length - 1; i++) {
        const gap = daysApart(ctx.timeline[i].filedDate, ctx.timeline[i + 1].filedDate);
        if (gap <= WINDOW_DAYS.TWELVE_MONTHS) return false;
      }
      return true;
    }
  }
];

// ---------------------------------------------------------------------------
// THE RUNNER
// ---------------------------------------------------------------------------

/**
 * Runs the FR-02 catalogue against one claim.
 *
 * Returns { fired, suppressed, skipped }. `fired` entries carry their own
 * severity ('indicator' or 'observation'); fraudAdvisor.js sorts them into the
 * advisory's two lists and decides the state from the indicators alone.
 *
 * DEGRADATION: a rule whose inputs are missing lands in `skipped` with what it
 * needed. It never quietly passes. An advisory that reported "no signals"
 * because it could not read the history would be actively misleading — the
 * agent would take a silent failure for a clean result.
 */
export function evaluateHistoryRules(claim, history) {
  const ctx = buildHistoryContext(claim, history);

  const fired = [];
  const suppressed = [];
  const skipped = [];
  const outcomes = new Map();
  const firedCodes = new Set();

  const isMissing = (key) => {
    const value = ctx[key];
    if (value === null || value === undefined) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  };

  // Two passes. The first evaluates the independent rules; the second handles
  // FR-02d, which needs the first pass's outcomes, and applies suppression,
  // which needs to know what actually fired.
  for (const rule of HISTORY_RULES) {
    if (rule.dependsOn) continue;

    const missing = (rule.requires || []).filter(([key]) => isMissing(key)).map(([, label]) => label);
    if (missing.length > 0) {
      skipped.push({ code: rule.code, label: rule.label, category: rule.category, missing });
      continue;
    }

    const outcome = rule.evaluate(ctx);
    if (!outcome) continue;

    outcomes.set(rule.code, outcome);
    firedCodes.add(rule.code);
  }

  for (const rule of HISTORY_RULES) {
    if (!rule.dependsOn) continue;

    const missing = (rule.requires || []).filter(([key]) => isMissing(key)).map(([, label]) => label);
    if (missing.length > 0) {
      skipped.push({ code: rule.code, label: rule.label, category: rule.category, missing });
      continue;
    }

    const outcome = rule.evaluate(ctx, {
      frequency: outcomes.get('FR-02a'),
      cumulative: outcomes.get('FR-02c')
    });
    if (!outcome) continue;

    outcomes.set(rule.code, outcome);
    firedCodes.add(rule.code);
  }

  // Suppression last, so `firedCodes` is complete when a test asks what else
  // fired. FR-02d is dropped alongside FR-02a when the frequency half of the
  // compound is withdrawn — leaving it standing would assert a combination one
  // of whose halves the engine has just decided not to raise.
  const suppressedCodes = new Set();
  for (const rule of HISTORY_RULES) {
    const outcome = outcomes.get(rule.code);
    if (!outcome) continue;

    const suppression = HISTORY_SUPPRESSIONS.find(
      entry => entry.appliesTo === rule.code && entry.test(ctx, firedCodes)
    );
    if (suppression) {
      suppressedCodes.add(rule.code);
      suppressed.push({
        code: rule.code,
        label: rule.label,
        category: rule.category,
        severity: outcome.severity,
        detail: outcome.detail,
        evidence: outcome.evidence,
        suppressionReason: suppression.reason
      });
    }
  }

  if (suppressedCodes.has('FR-02a') && outcomes.has('FR-02d')) {
    const compound = outcomes.get('FR-02d');
    suppressedCodes.add('FR-02d');
    suppressed.push({
      code: 'FR-02d',
      label: 'Frequency Combined With Amount',
      category: 'Claim History',
      severity: compound.severity,
      detail: compound.detail,
      suppressionReason: 'Withdrawn with FR-02a — the frequency half of this combination was suppressed.'
    });
  }

  for (const rule of HISTORY_RULES) {
    const outcome = outcomes.get(rule.code);
    if (!outcome || suppressedCodes.has(rule.code)) continue;

    fired.push({
      code: rule.code,
      label: rule.label,
      category: rule.category,
      severity: outcome.severity,
      detail: outcome.detail,
      evidence: outcome.evidence
    });
  }

  return { fired, suppressed, skipped, context: ctx };
}
