// data/policyRegister.js
//
// WHERE A CLAIM'S POLICY PERIOD COMES FROM.
//
// The fraud engine's two strongest rules — incident before inception (FR-01a)
// and incident after expiry (FR-01b) — need the policy's start and end dates.
// Nothing in the system currently holds them:
//
//   * the Mongoose claim schema (backend/src/server.js) has no policy dates;
//   * ocrData has no policy-schedule section, because no policy schedule is
//     among the required documents the adjuster uploads.
//
// So this file is the lookup of last resort. It is deliberately a plain,
// hand-maintained map rather than anything clever, and it is deliberately
// EMPTY by default: inventing a policy period for a claim would make the
// engine report a violation it cannot actually evidence, which is exactly what
// guardrail 4 forbids.
//
// Resolution order (see getPolicyPeriod below):
//   1. fields on the claim itself — `policyInceptionDate` / `policyExpiryDate`
//   2. an entry in POLICY_REGISTER, keyed by claim id
//   3. nothing, in which case FR-01a / FR-01b / FR-01d report themselves as
//      NOT EVALUATED rather than silently passing.
//
// TWO WAYS TO TURN THOSE RULES ON
//   * For a demo: add an entry below. No backend change, takes a minute.
//   * For real: add
//         policyInceptionDate: String,
//         policyExpiryDate: String,
//     to claimSchema in backend/src/server.js and populate them at claim
//     intake. Step 1 of the fraud plan already put exactly these two field
//     names on the legacy mock data, so the names are consistent across the
//     codebase. Once they arrive on the claim, step 1 above picks them up and
//     this file stops being consulted.

/**
 * Claim id → policy period. Dates are ISO 'YYYY-MM-DD' strings.
 *
 * Example (kept commented so it never fabricates coverage for a real claim):
 *
 *   'CLM-2026-8891': { inception: '2026-01-15', expiry: '2027-01-14' },
 */
export const POLICY_REGISTER = {};

/**
 * Returns { inception, expiry } as ISO strings, either of which may be null.
 *
 * Never guesses. A claim with no known policy period returns nulls, and the
 * engine treats that as "cannot evaluate", not as "no problem found".
 */
export function getPolicyPeriod(claim) {
  if (!claim) return { inception: null, expiry: null };

  const registered = POLICY_REGISTER[claim.id] || {};

  return {
    inception: claim.policyInceptionDate || registered.inception || null,
    expiry: claim.policyExpiryDate || registered.expiry || null
  };
}
