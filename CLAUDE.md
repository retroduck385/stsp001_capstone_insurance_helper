# InsureCopilot: Project Context for Claude Code

## What this is
A capstone prototype. A web-based assistant for Philippine motor-claims adjusters.
It consolidates claim documents, shows AI-extracted field values, runs rule-based
policy evaluation, and lets the adjuster correct extracted data and re-run analysis
before making a final decision. Human-in-the-loop is the core design principle.

## Stack
- `frontend/` Vite + React 18. Components under src/components, pure logic under
  src/services, static data under src/data.
- `backend/` Express + Mongoose. Claim schema and routes in src/server.js.
  Document upload and OCR routes in src/routes/. Gemini OCR is shelled out to
  backend/scripts/gemini_ocr.py.
- MongoDB Atlas, database `stsp_db`, collection driven by the `Claim` model.
- `screen.html` and `screen_V2.html` are dead single-file prototypes. Do not edit.

## The fraud module is an ADVISORY AGENT, not a detector

Its job is to warn a human insurance agent that a claim may be worth a closer look,
explain why in plain language, and suggest what to check. It never decides anything.

### Guardrails. These are not negotiable.

1. THE SYSTEM NEVER STATES THAT A CLAIM IS FRAUDULENT.
   Permitted wording: "potential fraud indicators", "recommended for agent review",
   "high-risk pattern", "worth verifying". Forbidden anywhere in code, UI copy, or
   AI prompts: "is fraud", "fraudulent claim", "the claimant lied", "fake", "scam".

2. FREQUENCY IS NOT FRAUD.
   Frequent claims are a risk pattern, not evidence of deception. Any UI that shows
   a frequency signal must also carry the high-risk-versus-fraud distinction. This
   is a required UI element, not a nice-to-have.

3. THE WARNING DOES NOT BLOCK THE DECISION.
   The agent can always approve, deny, or adjust. The module may require the agent
   to acknowledge the warning with a reason, and it logs that. It may never disable
   the approve action or lock a payout.

4. A FRAUD SIGNAL NEVER CHANGES THE PAYOUT.
   Nothing in the fraud path reads or writes approvedPayout or recommendedPayout.

5. THE AI EXPLAINS, THE RULES DECIDE.
   The deterministic rule layer alone sets Cleared / Not Cleared. The AI receives
   only the facts that layer already gathered, and writes reasoning and suggested
   checks. The AI cannot change the state, cannot introduce a new indicator, and
   cannot cite a fact it was not given. If the AI call fails, the module degrades to
   the rule output plus a clear "AI reasoning unavailable" notice, never to silence.

6. NO DEMOGRAPHIC OR PROXY INPUTS.
   Never read name-as-signal, address, barangay, age, sex, nationality, occupation,
   income, or source of funds into any rule or into the AI prompt. Identity fields
   are used ONLY to match claims to the same claimant, never as a risk signal.

7. EVERY SIGNAL CARRIES EVIDENCE.
   A signal names the prior claim ids, dates, or field values behind it. A signal
   with nothing to cite does not fire. When an input is missing, the rule reports
   itself as not evaluated. It must never pass silently.

8. FRAUD OUTPUT LIVES IN ITS OWN OBJECT.
   Never merge fraud signals into claim.rules. Policy rules mean "not covered".
   Fraud signals mean "worth checking". Confusing the two is the worst failure
   mode of a module like this, so the palettes and wording stay disjoint.

9. NOTHING FRAUD-RELATED EVER REACHES THE CLAIMANT.
   No claimant-facing email, notice, or status may mention review, suspicion,
   investigation, or fraud.

## Code conventions
- Match the existing style. Tailwind utilities inline, no new CSS files.
- Frontend imports are extensionless except in files that must also run under plain
  Node, where the .js extension is required.
- Currency renders as `₱{value.toLocaleString()}`.
- Do not add npm dependencies without asking. Gemini is called from Node via fetch
  against the REST API, not via a new SDK.

## Definition of done
`npm run dev` in both backend/ and frontend/ starts cleanly, no console errors,
and the existing approve / deny / OCR-correct flows still work unchanged.
