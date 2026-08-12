// services/fraudReasoner.js
//
// THE REASONING LAYER
// =============================================================================
// Takes a finished advisory — state already decided, indicators already fixed —
// and asks Gemini to explain it to the agent in plain language, offer the
// innocent reading, and suggest what to actually go and check.
//
//
// ── WHAT THIS IS NOT ALLOWED TO DO ──────────────────────────────────────────
// It cannot change `state`. It cannot add or remove an indicator. It cannot
// introduce a fact it was not given. Those are not conventions of this file,
// they are structural: buildFraudAdvisory() computes the state and freezes the
// indicator list BEFORE calling this, and the only thing it does with the
// return value is hang it off `advisory.ai`.
//
// The reason for that boundary is worth stating plainly, because it is the
// interesting part of the design: an LLM that can flip a claim's state on a
// hallucination can accuse a real person. So the model is given a decision
// somebody else already made and asked to explain it well.
//
//
// ── WHAT IS NEVER SENT ──────────────────────────────────────────────────────
// No name, address, barangay, age, sex, nationality, occupation, income, source
// of funds, government ID number, plate number or email leaves this file. See
// buildPromptPayload() below, which rebuilds the payload field by field from an
// allowlist rather than deleting fields from the advisory.
//
// That is deliberate. Blacklisting ("delete claim.policyholder") fails silently
// the moment a new identifying field is added upstream; an allowlist fails
// closed. claimantIdentity.js already restricts what the rules can see, and
// this file restricts it again on its own account rather than trusting its
// caller — the two are independent locks on the same door.

/** Matches the model backend/scripts/gemini_ocr.py already uses for OCR. */
export const REASONER_MODEL = 'gemini-3.6-flash';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Fail rather than hang the approve flow behind a slow model. */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * The system instruction. The guardrails are stated to the model in the same
 * words they are stated to us, because a prompt that paraphrases a rule is a
 * prompt that has already started to drift from it.
 */
const SYSTEM_INSTRUCTION = `
You are assisting a licensed Philippine motor insurance claims agent. You are NOT
making a decision and you are NOT determining whether fraud occurred.

You may ONLY reason about the indicators supplied below. You must not invent,
infer, or mention any fact that is not in the supplied data. If the data is thin,
say the data is thin.

Frequent claims are NOT fraud. A policyholder may have many legitimate claims and
simply be high-risk. Fraud requires intentional deception for financial gain, and
nothing in this data can establish intent. Your riskFraming field must state, for
this specific claim, what an innocent explanation of the pattern would look like.

Never write that the claim is fraudulent, that the claimant lied, or that the
claim should be denied. Write about what is worth verifying and why.

Your suggestedChecks must be concrete actions the agent can take with documents or
records, such as requesting a specific document or comparing two specific values.
Do not suggest contacting law enforcement.

You have not been told who the claimant is, and you must not ask or speculate.
Refer to them only as "the claimant".

Respond with a single JSON object and nothing else:
{
  "summary": "2 to 3 sentences telling the agent what was found and what it means for their next step",
  "reasoning": "a short paragraph explaining how the indicators relate to each other",
  "riskFraming": "what an innocent explanation of THIS specific pattern would look like",
  "suggestedChecks": ["3 to 5 concrete actions"]
}
`.trim();

/**
 * Rebuilds the prompt payload from an allowlist.
 *
 * Every field below is copied explicitly. Nothing is spread, and nothing is
 * deleted — if a new identifying field appears on an indicator's evidence block
 * upstream, it does not reach the model unless someone adds it here on purpose.
 */
function buildPromptPayload(advisory, claimContext) {
  const signal = (hit) => ({
    code: hit.code,
    label: hit.label,
    category: hit.category,
    detail: hit.detail,
    // Evidence is stringified rather than passed through, so nested objects
    // added upstream cannot smuggle a field past this allowlist.
    evidence: summariseEvidence(hit.evidence)
  });

  return {
    claimType: claimContext?.claimType ?? null,
    claimedAmount: claimContext?.claimedAmount ?? null,
    history: {
      priorClaimCount: advisory.history?.claimCount ?? 0,
      windowYears: advisory.history?.windowYears ?? null,
      totalClaimedAcrossWindow: advisory.history?.totalClaimed ?? null
      // NOTE: history.key and history.basis are NOT sent. The key is derived
      // from a government id or plate number and is therefore identifying.
    },
    indicators: (advisory.indicators || []).map(signal),
    observations: (advisory.observations || []).map(signal),
    // The suppressed list is sent so the model knows what the rule layer
    // already considered and ruled out, and does not re-raise it as new.
    ruledOut: (advisory.suppressed || []).map(hit => ({
      code: hit.code,
      label: hit.label,
      reasonNotRaised: hit.suppressionReason
    })),
    notEvaluated: (advisory.skipped || []).map(hit => ({
      code: hit.code,
      label: hit.label,
      missing: hit.missing
    }))
  };
}

/**
 * Flattens an evidence block to the non-identifying facts a rule cited.
 *
 * Claim ids are kept — they are references to claims, not to a person, and the
 * reasoning is far more useful when it can say which prior claim it means.
 */
function summariseEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;

  const allowed = {};
  const keys = [
    'priorClaimIds', 'claimIds', 'windowMonths', 'count', 'gapDays',
    'total', 'ceiling', 'part', 'occurrences',
    'estimate', 'severity', 'bandCeiling', 'multiple', 'damageDescription',
    'claimedAmount', 'difference', 'percentOver',
    'claimed', 'claimedLabel', 'comparedTo', 'comparedToLabel'
  ];

  for (const key of keys) {
    if (evidence[key] !== undefined && evidence[key] !== null) allowed[key] = evidence[key];
  }
  return Object.keys(allowed).length > 0 ? allowed : null;
}

/**
 * Pulls a JSON object out of a model response.
 *
 * Defensive on purpose: models wrap JSON in ```json fences, prefix it with
 * "Here is the analysis:", or return it with trailing prose. Anything that will
 * not parse is a failure, and a failure means the AI section is marked
 * unavailable — never that a fallback narrative gets invented.
 */
function parseModelJson(text) {
  if (!text) return null;

  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: the outermost {...} in the response.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Coerces the model's answer into the documented shape, dropping anything else. */
function normaliseReasoning(parsed) {
  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  const summary = text(parsed.summary);
  const reasoning = text(parsed.reasoning);
  const riskFraming = text(parsed.riskFraming);

  const suggestedChecks = Array.isArray(parsed.suggestedChecks)
    ? parsed.suggestedChecks.map(text).filter(Boolean).slice(0, 5)
    : [];

  // riskFraming is required, not optional. It is the field that carries
  // guardrail 2 — the high-risk-versus-fraud distinction — for this specific
  // claim. A response without it has not done the job it was asked to do.
  if (!summary || !riskFraming) return null;

  return { summary, reasoning, riskFraming, suggestedChecks };
}

/**
 * Asks Gemini to explain a NOT_CLEARED advisory.
 *
 * Resolves to { summary, reasoning, riskFraming, suggestedChecks, model,
 * generatedAt }, or to { unavailable: true, reason } when anything at all goes
 * wrong — a missing key, a network failure, a non-200, an unparseable body.
 *
 * IT NEVER THROWS AND IT NEVER INVENTS. The advisory's rule output is the part
 * that matters and it must render in full whatever happens here. A missing AI
 * response degrades the explanation; it must never degrade the warning, and it
 * must never be papered over with a generated-sounding paragraph the model did
 * not actually produce.
 */
export async function generateFraudReasoning(advisory, claimContext = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      unavailable: true,
      reason: 'GEMINI_API_KEY is not set on the server, so AI reasoning could not be generated.'
    };
  }

  const payload = buildPromptPayload(advisory, claimContext);

  // Logged once per run so the guardrail can be AUDITED rather than asserted —
  // verification test 10 reads this line and checks no claimant name is in it.
  console.log(`[fraudReasoner] outbound payload: ${JSON.stringify(payload)}`);

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{
      role: 'user',
      parts: [{
        text:
          'Here is the advisory produced by the deterministic rule layer. Explain it ' +
          'to the claims agent under the constraints in your instructions.\n\n' +
          JSON.stringify(payload, null, 2)
      }]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      // Low but not zero: the reasoning should read as prose, not as a template.
      temperature: 0.3
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT}/${REASONER_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        unavailable: true,
        reason: `The AI service returned ${response.status}. ${detail.slice(0, 200)}`.trim()
      };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text).join('') || '';

    const parsed = parseModelJson(text);
    if (!parsed) {
      return { unavailable: true, reason: 'The AI response could not be read as JSON.' };
    }

    const reasoning = normaliseReasoning(parsed);
    if (!reasoning) {
      return {
        unavailable: true,
        reason: 'The AI response was missing the required summary or risk-framing fields.'
      };
    }

    return { ...reasoning, model: REASONER_MODEL, generatedAt: new Date().toISOString() };
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `The AI service did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
      : `The AI service could not be reached: ${err.message}`;
    return { unavailable: true, reason };
  } finally {
    clearTimeout(timeout);
  }
}
