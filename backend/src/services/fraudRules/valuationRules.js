// services/fraudRules/valuationRules.js
//
// FR-03 — REPAIR COST AGAINST DOCUMENTED DAMAGE
// =============================================================================
// Cross-checks two things the system already holds and has never compared: what
// the repair estimate says the job costs, and what the damage photographs were
// read as showing. Needs no new data — ocrData.repairEstimate.totalEstimatedCost
// comes from the estimate document, and ocrData.vehicleDamagePictures.severity /
// damageDescription come from the Vision AI fallback.
//
//
// ── THE LIMITATION THAT SHAPES BOTH RULES ────────────────────────────────────
// `severity` is produced by a VISION MODEL, not by a human loss adjuster or an
// engineer. It is a guess made from photographs of unknown quality, angle and
// completeness. A model that reads heavy structural damage as "Minor" — because
// the only usable photo happened to be of an undamaged panel — will make this
// rule fire on a completely ordinary claim.
//
// So neither rule below concludes anything about the estimate. Both are prompts
// to LOOK AT THE PHOTOGRAPHS, and the agent-facing detail text is written to
// send the agent to that evidence rather than to assert that a number is
// inflated. This is the same reasoning as guardrail 5: the deterministic layer
// may only say what is worth checking.
//
// When severity is absent the rule reports itself as NOT EVALUATED. It must
// never be read as having passed — an estimate nobody could check is not an
// estimate that checked out.

/**
 * Expected repair cost ceiling per documented severity, in PHP.
 *
 * Exported as a named constant so it can be tuned in one place and cited in the
 * paper. These are judgement values calibrated against typical Philippine motor
 * repair costs, NOT figures derived from labelled outcome data — that
 * limitation belongs in the write-up.
 *
 * Severe has no ceiling: once damage is documented as severe there is no
 * estimate this rule can meaningfully call out, so it does not fire at all.
 */
export const SEVERITY_COST_BANDS = {
  minor: 60000,
  moderate: 180000,
  severe: null
};

/**
 * How the various words a vision model might return map onto the three bands.
 * Matched case-insensitively; an unrecognised word is treated as unreadable and
 * sends the rule to `skipped` rather than guessing at a band.
 */
const SEVERITY_SYNONYMS = {
  light: 'minor',
  minor: 'minor',
  superficial: 'minor',
  cosmetic: 'minor',
  medium: 'moderate',
  moderate: 'moderate',
  heavy: 'severe',
  severe: 'severe',
  major: 'severe',
  extensive: 'severe',
  total: 'severe'
};

/** Claimed amount may exceed the estimate by this fraction before FR-03b fires. */
export const CLAIMED_OVER_ESTIMATE_TOLERANCE = 0.10;

/** '₱240,000' — matches the currency convention used across the UI. */
function peso(amount) {
  return `₱${Number(amount || 0).toLocaleString('en-PH')}`;
}

/** Canonical band name for a raw severity string, or null if unreadable. */
export function canonicalSeverity(value) {
  if (value === null || value === undefined) return null;
  const word = String(value).toLowerCase().trim();
  if (!word) return null;

  if (SEVERITY_SYNONYMS[word]) return SEVERITY_SYNONYMS[word];

  // Tolerate phrases like 'minor damage' or 'moderate to severe'.
  const hit = Object.keys(SEVERITY_SYNONYMS).find(key => new RegExp(`\\b${key}\\b`).test(word));
  return hit ? SEVERITY_SYNONYMS[hit] : null;
}

/**
 * Everything the valuation rules may read, assembled once — same discipline as
 * the other two catalogues.
 */
export function buildValuationContext(claim) {
  const estimate = claim?.ocrData?.repairEstimate || {};
  const pictures = claim?.ocrData?.vehicleDamagePictures || {};

  const rawSeverity = pictures.severity ?? null;

  return {
    claimId: claim?.id || null,
    estimatedCost: typeof estimate.totalEstimatedCost === 'number' ? estimate.totalEstimatedCost : null,
    claimedAmount: typeof claim?.claimedAmount === 'number' ? claim.claimedAmount : null,
    rawSeverity,
    severity: canonicalSeverity(rawSeverity),
    damageDescription: pictures.damageDescription ?? null,
    // The document the photographs came from, so "View evidence" can scroll to it.
    sourceDoc: (claim?.documents || []).find(doc => {
      const haystack = `${doc.documentType || ''} ${doc.title || ''} ${doc.fileName || ''}`.toLowerCase();
      return haystack.includes('damage') || haystack.includes('picture') || haystack.includes('photo');
    })?.id || null
  };
}

export const VALUATION_RULES = [
  {
    code: 'FR-03a',
    label: 'Repair Cost Inconsistent With Documented Damage',
    category: 'Valuation',
    requires: [
      ['estimatedCost', 'the total on the repair estimate'],
      ['severity', 'a readable damage severity from the photographs']
    ],
    evaluate: (ctx) => {
      const ceiling = SEVERITY_COST_BANDS[ctx.severity];

      // Severe has no ceiling — nothing to compare against, so nothing to say.
      if (ceiling === null || ceiling === undefined) return null;
      if (ctx.estimatedCost <= ceiling) return null;

      const multiple = (ctx.estimatedCost / ceiling).toFixed(1);
      const severityLabel = ctx.severity.charAt(0).toUpperCase() + ctx.severity.slice(1);

      return {
        severity: 'indicator',
        evidence: {
          estimate: ctx.estimatedCost,
          severity: ctx.rawSeverity,
          bandCeiling: ceiling,
          multiple: Number(multiple),
          damageDescription: ctx.damageDescription,
          sourceDoc: ctx.sourceDoc,
          fieldId: 'totalEstimatedCost'
        },
        detail:
          `Repair estimate of ${peso(ctx.estimatedCost)} is ${multiple}x the ${peso(ceiling)} upper bound ` +
          `for damage documented as ${severityLabel}. ` +
          (ctx.damageDescription ? `The photographs were read as: "${ctx.damageDescription}". ` : '') +
          `Compare the estimate line items against the damage photographs. Note that the severity ` +
          `reading is produced by an image model, not by an inspector — if the photographs show more ` +
          `damage than the reading suggests, this signal is the one that is wrong.`
      };
    }
  },

  {
    code: 'FR-03b',
    label: 'Claimed Amount Exceeds Repair Estimate',
    category: 'Valuation',
    requires: [
      ['estimatedCost', 'the total on the repair estimate'],
      ['claimedAmount', 'the amount claimed']
    ],
    evaluate: (ctx) => {
      if (ctx.estimatedCost <= 0) return null;

      const difference = ctx.claimedAmount - ctx.estimatedCost;
      if (difference <= ctx.estimatedCost * CLAIMED_OVER_ESTIMATE_TOLERANCE) return null;

      const percent = ((difference / ctx.estimatedCost) * 100).toFixed(1);

      return {
        severity: 'indicator',
        evidence: {
          claimedAmount: ctx.claimedAmount,
          estimate: ctx.estimatedCost,
          difference,
          percentOver: Number(percent),
          fieldId: 'totalEstimatedCost',
          sourceDoc: ctx.sourceDoc
        },
        detail:
          `Claimed amount of ${peso(ctx.claimedAmount)} exceeds the ${peso(ctx.estimatedCost)} repair ` +
          `estimate by ${peso(difference)} (${percent}%). Ask what the difference covers — towing, ` +
          `storage and parts ordered separately are common and legitimate answers that simply are not ` +
          `on the estimate document.`
      };
    }
  }
];

/**
 * Runs the FR-03 catalogue against one claim.
 *
 * Returns { fired, suppressed, skipped }. `suppressed` is always empty — these
 * two rules have no suppression conditions — and is returned anyway so the
 * shape matches evaluateHistoryRules() and fraudAdvisor.js can treat the two
 * catalogues identically.
 */
export function evaluateValuationRules(claim) {
  const ctx = buildValuationContext(claim);

  const fired = [];
  const skipped = [];

  for (const rule of VALUATION_RULES) {
    const missing = (rule.requires || [])
      .filter(([key]) => ctx[key] === null || ctx[key] === undefined)
      .map(([, label]) => label);

    if (missing.length > 0) {
      skipped.push({ code: rule.code, label: rule.label, category: rule.category, missing });
      continue;
    }

    const outcome = rule.evaluate(ctx);
    if (!outcome) continue;

    fired.push({
      code: rule.code,
      label: rule.label,
      category: rule.category,
      severity: outcome.severity,
      detail: outcome.detail,
      evidence: outcome.evidence
    });
  }

  return { fired, suppressed: [], skipped, context: ctx };
}
