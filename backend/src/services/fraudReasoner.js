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
import { collectGroundTruth, checkGrounding } from './fraudGrounding.js';

/**
 * The models this agent will try, best first.
 *
 * WHY A LADDER AND NOT ONE MODEL.
 * The agent makes several calls per advisory rather than one, so it exhausts a
 * free-tier quota far faster than the old single-shot reasoner did. When that
 * happened the whole AI section collapsed to "unavailable" — correct behaviour,
 * but it meant the most informative part of the card was routinely a grey box.
 *
 * Gemini quotas are per-model, which is the fact that makes this work: a 429 on
 * gemini-3.6-flash says nothing about gemini-2.5-flash, so stepping down the
 * ladder gets a genuinely fresh allowance rather than hitting the same wall four
 * times. Every model here was verified against this project's key to respond and
 * to support function calling, so the agent's tools survive a downgrade intact.
 *
 * Order is capability first, quota last. gemini-3.5-flash-lite is the floor
 * because a weaker explanation is still worth more than no explanation, and the
 * rule layer — which decides everything that matters — is unaffected either way.
 */
export const MODEL_LADDER = [
  'gemini-3.6-flash',      // primary; matches backend/scripts/gemini_ocr.py
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite'  // last resort, largest quota
];

/** The model the advisory prefers. Exported for the UI's "fell back" notice. */
export const PRIMARY_MODEL = MODEL_LADDER[0];

/**
 * HTTP statuses worth trying the next model for.
 *
 * All of these are about the SERVICE: out of quota, overloaded, or broken. A
 * different model plausibly succeeds.
 *
 * Deliberately absent: 400, 401, 403, 404. Those mean our request or our key is
 * wrong, and every model in the ladder will reject it identically — retrying
 * would turn one honest error into four and bury the real cause.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

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

/**
 * One request to Gemini against a named model.
 *
 * Throws an Error carrying `status` (when the service answered) and `retryable`
 * (whether the ladder should try the next model). Both are set here so the
 * decision to fall back is made in one place from one rule.
 */
async function callGemini({ apiKey, model, contents, tools }) {
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
    const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`The AI service returned ${response.status}. ${detail.slice(0, 200)}`.trim());
      error.handled = true;
      error.status = response.status;
      error.retryable = RETRYABLE_STATUSES.has(response.status);
      throw error;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content ?? null;
  } catch (err) {
    // A timeout or a dropped connection is a service problem like any other, so
    // it earns the next model rather than ending the run.
    if (err.status === undefined) {
      err.retryable = true;
      err.outcome = err.name === 'AbortError' ? 'timeout' : 'network';
    }
    throw err;
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
 * One complete agent run against ONE model.
 *
 * Resolves to a finished reasoning object, or to { failed, reason, retryable }.
 * Throws nothing — the ladder above decides what to do with a failure.
 *
 * `trail` is passed in rather than created here so that a run which dies partway
 * still leaves its completed tool calls behind for the caller to show.
 */
async function runAgent({ apiKey, model, payload, tools, trail }) {
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

  for (let turn = 1; turn <= MAX_TOOL_TURNS; turn++) {
    const isFinalTurn = turn === MAX_TOOL_TURNS;

    // On the last permitted turn the tools are withdrawn, so the model has no
    // option but to write. Without this a model that keeps investigating
    // produces nothing at all.
    const content = await callGemini({
      apiKey,
      model,
      contents,
      tools: tools && !isFinalTurn ? tools.declarations : null
    });

    if (!content) {
      // An empty candidate is usually a safety stop or a truncation. Another
      // model may well answer, so this earns a step down the ladder.
      return { failed: true, reason: 'The AI service returned an empty response.', retryable: true };
    }

    const calls = functionCallsIn(content);

    if (calls.length === 0) {
      // The model has stopped investigating and written something.
      const parsed = parseModelJson(textIn(content));
      if (!parsed) {
        return { failed: true, reason: 'The AI response could not be read as JSON.', retryable: true };
      }

      const reasoning = normaliseReasoning(parsed);
      if (!reasoning) {
        return {
          failed: true,
          reason: 'The AI response was missing the required summary or risk-framing fields.',
          retryable: true
        };
      }

      return { ...reasoning, turns: turn };
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

  return {
    failed: true,
    reason: `The AI kept investigating past ${MAX_TOOL_TURNS} turns without writing an analysis.`,
    // A model that will not stop investigating will probably not stop on a
    // retry either, and each attempt costs several calls. Take the loss.
    retryable: false
  };
}

/**
 * Runs the reasoning agent over a NOT_CLEARED advisory, stepping down the model
 * ladder until one answers.
 *
 * Resolves to { summary, reasoning, riskFraming, suggestedChecks, trail,
 * toolCallCount, turns, model, modelAttempts, grounding, generatedAt }, or to
 * { unavailable: true, reason, trail, modelAttempts } when every model failed.
 *
 * IT NEVER THROWS AND IT NEVER INVENTS. The advisory's rule output is the part
 * that matters and it must render in full whatever happens here. A missing AI
 * response degrades the explanation; it must never degrade the warning, and it
 * must never be papered over with a generated-sounding paragraph the model did
 * not actually produce.
 *
 * WHY THE WHOLE RUN RETRIES, NOT THE INDIVIDUAL CALL.
 * The agent loop accumulates a `contents` transcript containing the model's own
 * function calls. Swapping model mid-conversation would hand the next model a
 * record of someone else's tool use as though it were its own. Restarting is
 * cleaner, and costs little in practice because a quota failure almost always
 * lands on the first call of a run.
 */
export async function generateFraudReasoning(advisory, claimContext = {}, { ClaimModel, claim } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const trail = [];
  const modelAttempts = [];

  if (!apiKey) {
    return {
      unavailable: true,
      reason: 'GEMINI_API_KEY is not set on the server, so AI reasoning could not be generated.',
      trail,
      modelAttempts
    };
  }

  const payload = buildPromptPayload(advisory, claimContext);

  // Logged once per run so the guardrail can be AUDITED rather than asserted —
  // the verification suite reads this line and checks no claimant name is in it.
  console.log(`[fraudReasoner] outbound payload: ${JSON.stringify(payload)}`);

  const tools = ClaimModel && claim ? buildFraudTools(ClaimModel, claim, advisory) : null;

  let lastReason = 'No model was attempted.';

  for (let i = 0; i < MODEL_LADDER.length; i++) {
    const model = MODEL_LADDER[i];
    const isLastModel = i === MODEL_LADDER.length - 1;

    // Where this attempt's tool calls start. A failed attempt's calls are
    // discarded before the next model runs, so the trail always describes ONE
    // coherent investigation rather than several models' calls concatenated
    // into an investigation nobody actually performed.
    const before = trail.length;

    try {
      const result = await runAgent({ apiKey, model, payload, tools, trail });

      if (!result.failed) {
        modelAttempts.push({ model, outcome: 'ok' });

        // The model has written. Before returning it, check that every figure
        // and claim id in the prose traces back to something it was actually
        // given — see fraudGrounding.js for what that does and does not prove.
        const grounding = checkGrounding(result, collectGroundTruth(payload, trail));

        if (!grounding.verified) {
          console.warn(
            `[fraudReasoner] ${grounding.unsupported.length} untraceable figure(s) in ${model}'s ` +
            `analysis: ${grounding.unsupported.map(u => u.value).join(', ')}`
          );
        }

        return {
          ...result,
          trail,
          toolCallCount: trail.length,
          grounding,
          model,
          modelAttempts,
          generatedAt: new Date().toISOString()
        };
      }

      modelAttempts.push({ model, outcome: result.reason });
      lastReason = result.reason;
      if (!result.retryable) break;
    } catch (err) {
      const outcome = err.status ? String(err.status) : (err.outcome || 'error');
      modelAttempts.push({ model, outcome });

      lastReason = err.name === 'AbortError'
        ? `${model} did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
        : err.handled
          ? err.message
          : `${model} could not be reached: ${err.message}`;

      // Our own bad request, or a bad key — every model will reject it the same
      // way, so stop rather than manufacturing three more identical errors.
      if (!err.retryable) break;
    }

    // Discard a partial investigation from a failed attempt — but only when
    // there is another model to try. On the last one the partial is all there
    // is, and a run that died after two useful lookups should still show them.
    if (!isLastModel) trail.length = before;
  }

  const tried = modelAttempts.map(a => `${a.model} (${a.outcome})`).join(', ');
  return {
    unavailable: true,
    reason: `No AI model was available. Tried: ${tried}. Last error: ${lastReason}`,
    trail,
    modelAttempts
  };
}
