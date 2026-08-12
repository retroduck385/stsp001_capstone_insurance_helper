// services/fraudReasoner.js
//
// THE REASONING AGENT
// =============================================================================
// Takes a finished advisory — state already decided, indicators already fixed —
// and runs a tool-using model over it. The model may look up the prior claims
// the rules cited, check which documents are on file, and read what a rule
// actually tests, before writing its analysis for the agent.
//
//
// ── WHAT IS AND IS NOT AGENTIC HERE ─────────────────────────────────────────
// Agentic: the model chooses which tools to call, with which arguments, in
// which order, and when it has read enough to stop. Nothing in this file
// scripts that sequence. Two claims with the same indicators can produce
// different investigations.
//
// Not agentic, deliberately: the model has no authority over the outcome. It
// cannot change `state`, cannot add or remove an indicator, and cannot write
// anything anywhere. buildFraudAdvisory() computes the state and freezes the
// indicator list BEFORE calling this, and the only thing it does with the
// return value is hang it off `advisory.ai`.
//
// The reason for that boundary is the whole argument of the module: an LLM that
// can flip a claim's state on a hallucination can accuse a real person. So the
// model is given a decision somebody else already made, the means to look into
// the evidence behind it, and the job of explaining it well.
//
//
// ── WHAT IS NEVER SENT ──────────────────────────────────────────────────────
// No name, address, barangay, age, sex, nationality, occupation, income, source
// of funds, government ID number, plate number or email leaves this file — not
// in the opening prompt, and not in any tool result. There are two independent
// locks: buildPromptPayload() below rebuilds the prompt from an allowlist, and
// fraudTools.js restricts what every tool may return.
//
// Both are allowlists, not blacklists. Deleting fields ("delete claim.
// policyholder") fails silently the moment a new identifying field appears
// upstream; rebuilding from a named list fails closed.

import { buildFraudTools } from './fraudTools.js';

/** Matches the model backend/scripts/gemini_ocr.py already uses for OCR. */
export const REASONER_MODEL = 'gemini-3.6-flash';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Fail rather than hang the approve flow behind a slow model. */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * How many times the model may come back for more before it must write.
 *
 * A cap rather than a target — most claims resolve in one or two. It exists so
 * a model that loops (asking for the same claim repeatedly, or alternating
 * between two tools) burns a bounded amount of quota and still produces a
 * result. On hitting the cap the loop asks once more with tools withdrawn, so
 * the outcome is a written analysis rather than a timeout.
 */
const MAX_TOOL_TURNS = 6;

/**
 * The system instruction. The guardrails are stated to the model in the same
 * words they are stated to us, because a prompt that paraphrases a rule is a
 * prompt that has already started to drift from it.
 */
const SYSTEM_INSTRUCTION = `
You are assisting a licensed Philippine motor insurance claims agent. You are NOT
making a decision and you are NOT determining whether fraud occurred.

You may ONLY reason about the indicators supplied below. You must not invent,
infer, or mention any fact that is not in the supplied data or returned by a tool.
If the data is thin, say the data is thin.

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

BEFORE YOU WRITE, INVESTIGATE.
You have tools. Use them when they would make your analysis more specific:
  - lookupPriorClaim, to examine a prior claim a rule cited as evidence
  - listClaimDocuments, to check what is actually on file before you suggest
    obtaining or re-reading a document
  - getRuleDefinition, to confirm what a rule tests before you explain why it fired
Call only the tools that will change what you write. Two or three well-chosen
calls beat six. When you have enough, stop calling tools and write your analysis.

The rule engine has already decided this claim's state. You cannot change it, and
you must not argue for a different one. If something you find in a tool result
sits awkwardly with an indicator, say so plainly in your reasoning — that is
useful to the agent — but do not treat it as overturning the finding.

When you are finished investigating, respond with a single JSON object and
nothing else:
{
  "summary": "2 to 3 sentences telling the agent what was found and what it means for their next step",
  "reasoning": "a short paragraph explaining how the indicators relate to each other",
  "riskFraming": "what an innocent explanation of THIS specific pattern would look like",
  "suggestedChecks": ["3 to 5 concrete actions"]
}
`.trim();

// ---------------------------------------------------------------------------
// THE OPENING PAYLOAD
// ---------------------------------------------------------------------------

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
    // Evidence is rebuilt key by key rather than passed through, so nested
    // objects added upstream cannot smuggle a field past this allowlist.
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
 * reasoning is far more useful when it can say which prior claim it means. They
 * are also what lookupPriorClaim is fenced to, so the model needs to see them
 * in order to know what it is allowed to ask for.
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

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------

/**
 * Pulls a JSON object out of a model response.
 *
 * Defensive on purpose, and necessarily so: Gemini will not accept
 * responseMimeType 'application/json' alongside a tool declaration, so the
 * final turn comes back as free text that merely promises to be JSON. Models
 * wrap it in ```json fences, prefix it with "Here is the analysis:", or trail
 * prose after it. Anything that will not parse is a failure, and a failure
 * means the AI section is marked unavailable — never that a fallback narrative
 * gets invented.
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

// ---------------------------------------------------------------------------
// THE MODEL CALL
// ---------------------------------------------------------------------------

/** One request to Gemini. Resolves to the candidate's content, or throws. */
async function callGemini({ apiKey, contents, tools }) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    // Low but not zero: the reasoning should read as prose, not as a template.
    generationConfig: { temperature: 0.3 }
  };

  // Tools are withdrawn on the final turn, which is how the loop forces a
  // written answer out of a model that would otherwise keep investigating.
  if (tools) body.tools = [{ functionDeclarations: tools }];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/${REASONER_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`The AI service returned ${response.status}. ${detail.slice(0, 200)}`.trim());
      error.handled = true;
      throw error;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Every functionCall part in one model turn. Gemini may emit several at once. */
function functionCallsIn(content) {
  return (content?.parts || []).filter(part => part.functionCall).map(part => part.functionCall);
}

/** Concatenated text of one model turn. */
function textIn(content) {
  return (content?.parts || []).filter(part => part.text).map(part => part.text).join('');
}

// ---------------------------------------------------------------------------

/**
 * Runs the reasoning agent over a NOT_CLEARED advisory.
 *
 * Resolves to { summary, reasoning, riskFraming, suggestedChecks, trail,
 * toolCallCount, turns, model, generatedAt }, or to { unavailable: true,
 * reason, trail } when anything goes wrong.
 *
 * IT NEVER THROWS AND IT NEVER INVENTS. The advisory's rule output is the part
 * that matters and it must render in full whatever happens here. A missing AI
 * response degrades the explanation; it must never degrade the warning, and it
 * must never be papered over with a generated-sounding paragraph the model did
 * not actually produce.
 *
 * `trail` records every tool call the model made, in order, including refused
 * ones. It is returned even on failure — a run that died after two useful
 * lookups should still show them.
 */
export async function generateFraudReasoning(advisory, claimContext = {}, { ClaimModel, claim } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const trail = [];

  if (!apiKey) {
    return {
      unavailable: true,
      reason: 'GEMINI_API_KEY is not set on the server, so AI reasoning could not be generated.',
      trail
    };
  }

  const payload = buildPromptPayload(advisory, claimContext);

  // Logged once per run so the guardrail can be AUDITED rather than asserted —
  // the verification suite reads this line and checks no claimant name is in it.
  console.log(`[fraudReasoner] outbound payload: ${JSON.stringify(payload)}`);

  const tools = ClaimModel && claim ? buildFraudTools(ClaimModel, claim, advisory) : null;

  const contents = [{
    role: 'user',
    parts: [{
      text:
        'Here is the advisory produced by the deterministic rule layer. Investigate it with ' +
        'your tools where that would make your analysis more specific, then explain it to the ' +
        'claims agent under the constraints in your instructions.\n\n' +
        JSON.stringify(payload, null, 2)
    }]
  }];

  try {
    for (let turn = 1; turn <= MAX_TOOL_TURNS; turn++) {
      const isFinalTurn = turn === MAX_TOOL_TURNS;

      // On the last permitted turn the tools are withdrawn, so the model has no
      // option but to write. Without this a model that keeps investigating
      // produces nothing at all.
      const content = await callGemini({
        apiKey,
        contents,
        tools: tools && !isFinalTurn ? tools.declarations : null
      });

      if (!content) {
        return { unavailable: true, reason: 'The AI service returned an empty response.', trail };
      }

      const calls = functionCallsIn(content);

      if (calls.length === 0) {
        // The model has stopped investigating and written something.
        const parsed = parseModelJson(textIn(content));
        if (!parsed) {
          return { unavailable: true, reason: 'The AI response could not be read as JSON.', trail };
        }

        const reasoning = normaliseReasoning(parsed);
        if (!reasoning) {
          return {
            unavailable: true,
            reason: 'The AI response was missing the required summary or risk-framing fields.',
            trail
          };
        }

        return {
          ...reasoning,
          trail,
          toolCallCount: trail.length,
          turns: turn,
          model: REASONER_MODEL,
          generatedAt: new Date().toISOString()
        };
      }

      // The model asked for something. Run every call it made, record each one,
      // and hand the results back for the next turn.
      contents.push(content);

      const responseParts = [];
      for (const call of calls) {
        const result = await tools.execute(call.name, call.args);

        trail.push({
          step: trail.length + 1,
          tool: call.name,
          args: call.args || {},
          // The fence records refusals as loudly as successes. A model that
          // tried to open a claim the rules never cited is something the agent
          // reading this card is entitled to see.
          refused: Boolean(result?.error),
          result
        });

        responseParts.push({
          functionResponse: { name: call.name, response: result }
        });
      }

      contents.push({ role: 'user', parts: responseParts });
    }

    // Fell out of the loop without a written answer.
    return {
      unavailable: true,
      reason: `The AI kept investigating past ${MAX_TOOL_TURNS} turns without writing an analysis.`,
      trail
    };
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `The AI service did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
      : err.handled
        ? err.message
        : `The AI service could not be reached: ${err.message}`;
    return { unavailable: true, reason, trail };
  }
}
