// services/claimantIdentity.js
//
// WHO FILED THIS CLAIM, AND WHAT ELSE HAVE THEY FILED?
// =============================================================================
// Every FR-02 history rule is a question about one claimant's other claims, so
// everything downstream rests on being able to say "these two claims are the
// same person" — correctly, and for a stated reason.
//
// This is the part of the module most likely to be wrong in a way nobody
// notices. Matching on `policyholder` alone would look like it worked: it would
// find most of a claimant's history most of the time. It would also miss the
// one record where the name was typed differently, undercount the history, and
// clear a claim that should have been raised. A quietly incomplete history is
// worse than no history, because the advisory reports CLEARED with the same
// confidence either way.
//
//
// ── GUARDRAIL 6, RESTATED WHERE IT MATTERS ───────────────────────────────────
// The identity fields read below are used for ONE purpose: grouping claims that
// belong to the same claimant. They are never a risk signal, never scored, and
// never forwarded to the AI. Nothing in this file reads address, barangay, age,
// sex, nationality, occupation, income or source of funds — those fields exist
// in ocrData and are deliberately untouched. See fraudReasoner.js, which strips
// identifying fields again on its own account rather than trusting its caller.

/** How far back history is read by default, in years. */
export const DEFAULT_WINDOW_YEARS = 5;

// ---------------------------------------------------------------------------
// NORMALISATION
// ---------------------------------------------------------------------------

/**
 * Normalises a government id or plate number: strip everything that is not a
 * letter or digit, then uppercase.
 *
 *   'JDC-1985-004521' → 'JDC1985004521'
 *   'abc 1234'        → 'ABC1234'
 *
 * This is exact matching with the punctuation noise removed. It cannot create a
 * false link between two different numbers.
 */
export function normaliseId(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
  return cleaned || null;
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/**
 * Normalises a person's name: lowercase, strip punctuation, collapse
 * whitespace, drop common generational suffixes.
 *
 *   'Juan Dela Cruz, Jr.' → 'juan dela cruz'
 *
 * DELIBERATELY NOT FUZZY. No Levenshtein distance, no soundex, no metaphone,
 * no token-set ratio. Fuzzy name matching would link 'Maria Santos' to 'Mario
 * Santos' and 'Juan Dela Cruz' to 'Juan De La Cruz Jr' — sometimes correctly
 * and sometimes not, with no way for the agent to tell which. This module's
 * output can lead to a real person being investigated. A signal built on a
 * probabilistic name match cannot carry that weight, so names are only ever
 * compared exactly, and only ever as the weakest fallback below.
 */
export function normaliseName(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(part => part && !NAME_SUFFIXES.has(part))
    .join(' ')
    .trim();
  return cleaned || null;
}

/** Reads a motorClaimForm field out of the nested ocrData shape MongoDB stores. */
function formField(claim, fieldId) {
  const value = claim?.ocrData?.motorClaimForm?.[fieldId];
  return value === undefined || value === '' ? null : value;
}

// ---------------------------------------------------------------------------
// RESOLUTION
// ---------------------------------------------------------------------------

/**
 * Works out a stable identity key for one claim, and says how it got there.
 *
 * Returns { key, basis, confidence }. `key` is null only when the claim carries
 * no usable identifier at all, in which case history cannot be read and the
 * rules must report themselves as not evaluated rather than as clean.
 *
 * The order is strongest evidence first:
 *
 *   1. government id   high    a number issued to one person
 *   2. plate           medium  see the caveat below
 *   3. name + email    medium  two weak things agreeing
 *   4. name alone      low     better than nothing, and flagged as such
 *
 * `basis` and `confidence` are not decoration — they are rendered in the
 * advisory card's footer so the agent can see what the history was matched on.
 * A HIGH-concern advisory built on a name-only match should be read differently
 * from one built on a government id, and the only way that can happen is if the
 * UI is told which it was.
 */
export function resolveClaimantKey(claim) {
  if (!claim) return { key: null, basis: null, confidence: null };

  // 1. GOVERNMENT ID — the only identifier here that belongs to a person and
  //    to nobody else.
  const govId = normaliseId(formField(claim, 'assured_id_no'));
  if (govId) {
    return { key: `gov:${govId}`, basis: 'government_id', confidence: 'high' };
  }

  // 2. PLATE NUMBER.
  //    KNOWN LIMITATION, and it is surfaced rather than hidden: a plate follows
  //    the VEHICLE, not the person. If a car is sold, two unrelated owners
  //    resolve to the same key and one person inherits the other's claim
  //    history. That is why this basis is only 'medium' confidence and why the
  //    advisory card prints a caution line whenever it is used. The alternative
  //    — dropping plate matching entirely — would lose the history of every
  //    claimant whose id number was not captured by OCR, which is the more
  //    common failure by far.
  const plate = normaliseId(formField(claim, 'vehicle_plate_no'));
  if (plate) {
    return { key: `plate:${plate}`, basis: 'plate', confidence: 'medium' };
  }

  // 3. NAME + EMAIL. Two weak identifiers that have to agree.
  const name = normaliseName(claim.policyholder);
  const email = claim.email ? String(claim.email).trim().toLowerCase() : null;
  if (name && email) {
    return { key: `nameemail:${name}|${email}`, basis: 'name_email', confidence: 'medium' };
  }

  // 4. NAME ALONE. The weakest thing that is still exact, reported as low
  //    confidence so the UI can caution the agent about it.
  if (name) {
    return { key: `name:${name}`, basis: 'name_only', confidence: 'low' };
  }

  return { key: null, basis: null, confidence: null };
}

// ---------------------------------------------------------------------------
// HISTORY LOOKUP
// ---------------------------------------------------------------------------

/**
 * The claim fields the history rules are allowed to see.
 *
 * Deliberately narrow. The rules need counts, dates, amounts and part names —
 * nothing else. Returning whole documents would hand every downstream rule (and
 * anything that later logs them) the claimant's full OCR record, including the
 * demographic fields guardrail 6 forbids. Restricting the projection here is
 * what makes that guardrail enforceable by reading one function.
 */
// NOTE ON approvedPayout, WHICH IS NOT HERE.
// The original specification listed it among the fields to return. It is
// deliberately omitted: no rule in the FR-02 catalogue reads it — FR-02c
// measures what was CLAIMED, not what was settled — so carrying it would put a
// payout figure inside the fraud path for no benefit at all.
//
// Guardrail 4 says nothing in the fraud path reads or writes approvedPayout.
// Leaving it out makes that true by construction rather than true by nobody
// having used it yet, and removes the field that a future rule might reach for
// without noticing what it was reaching into.
const HISTORY_PROJECTION = {
  id: 1,
  createdAt: 1,
  decidedAt: 1,
  status: 1,
  claimType: 1,
  claimedAmount: 1,
  'ocrData.repairEstimate.detectedParts': 1,
  // Needed only to re-resolve each candidate's key in JS — see below.
  'ocrData.motorClaimForm.assured_id_no': 1,
  'ocrData.motorClaimForm.vehicle_plate_no': 1,
  policyholder: 1,
  email: 1
};

/** Strips the match-only fields back off before the rules ever see a claim. */
function toHistoryRecord(doc) {
  return {
    id: doc.id,
    createdAt: doc.createdAt,
    decidedAt: doc.decidedAt ?? null,
    status: doc.status ?? null,
    claimType: doc.claimType ?? null,
    claimedAmount: doc.claimedAmount ?? null,
    detectedParts: doc.ocrData?.repairEstimate?.detectedParts ?? []
  };
}

/**
 * Finds every other claim belonging to the same claimant inside the window.
 *
 * Returns { key, basis, confidence, claims, windowYears }, newest first, with
 * the subject claim itself excluded.
 *
 *
 * WHY THIS FILTERS IN JAVASCRIPT RATHER THAN IN THE QUERY
 * The identity key is a DERIVED value — normalised, and resolved through a
 * four-step fallback. MongoDB cannot match on it without the normalised form
 * being stored on every document, which would mean a migration and a write path
 * that has to keep it in step forever. So the query narrows by the one thing it
 * can (the time window), and the key is resolved per candidate in JS. The
 * collection holds tens of claims; if it ever held millions, the right fix is a
 * stored, indexed `claimantKey` written at intake, not a cleverer query here.
 *
 * A claim with no resolvable key returns an empty history AND a null key, which
 * the rules read as "could not check" rather than "nothing found".
 */
export async function findClaimantHistory(ClaimModel, claim, { years = DEFAULT_WINDOW_YEARS } = {}) {
  const { key, basis, confidence } = resolveClaimantKey(claim);

  const windowStart = new Date();
  windowStart.setFullYear(windowStart.getFullYear() - years);

  const base = { key, basis, confidence, windowYears: years, windowStart };

  if (!key) return { ...base, claims: [] };

  // Claims with no createdAt at all cannot be placed in the window and are
  // excluded by this filter. That is correct: a rule about how many claims were
  // filed in twelve months cannot count a claim with no filing date, and
  // counting it anyway would be an invented fact.
  const candidates = await ClaimModel.find(
    { id: { $ne: claim.id }, createdAt: { $gte: windowStart } },
    HISTORY_PROJECTION
  ).lean();

  const claims = candidates
    .filter(candidate => resolveClaimantKey(candidate).key === key)
    .map(toHistoryRecord)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { ...base, claims };
}
