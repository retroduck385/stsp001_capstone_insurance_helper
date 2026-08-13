# InsureCopilot Fraud Advisory: How It Is Agentic

Companion to `FRAUD_MODULE.md`. That file is the reference. This one answers a
narrower question: **in what sense is this an agent, and what does that buy us?**

Three parts:
- Part A, the formal version. For the paper, the defence, and the adviser.
- Part B, the plain version. For getting a teammate productive in ten minutes.
- Part C, the agentic tree. Triggers, control flow, and every exit path.

Branch: `fraud-test`. Code under `backend/src/services/`.

---

# PART A: The Formal Version

## A1. Definition and scope of the agentic claim

The fraud module is best described as a **bounded investigative agent operating
under a deterministic authority layer**. The distinction that governs the entire
design is between *investigation* and *decision*:

> The model may investigate. It may not decide.

This is not a stylistic preference. It follows from the nature of the module's
primary signal. Claim frequency is a well-established trigger for investigation
and is equally well established as not constituting evidence of deception. A
policyholder with several legitimate claims arising from separate verifiable
events is a high-risk customer, not a fraudulent one. Fraud requires intentional
deception for financial gain, and no count of claims can establish intent.

It follows that a module whose principal input is frequency has no epistemic
warrant to reach a conclusion. It may only surface a pattern for human
adjudication. Every architectural decision below is downstream of that
constraint.

## A2. What qualifies the system as agentic

The system satisfies the standard criteria for an agentic architecture on three
counts, while deliberately failing a fourth.

**1. Autonomous tool selection.** The reasoning model is supplied with three
read-only tools and no prescribed sequence for using them. It determines which
tools are relevant, with what arguments, in what order, and when sufficient
information has been gathered. No branch of the control flow scripts a tool call.
Two claims presenting identical indicators may therefore produce materially
different investigations.

**2. Iterative, state-carrying execution.** The interaction is a multi-turn loop
(`runAgent`, `fraudReasoner.js`) rather than a single-shot generation. Each turn's
tool results are appended to a running transcript and inform the model's
subsequent requests, permitting genuine follow-up: retrieving a prior claim,
observing an anomaly in it, and then querying a rule definition to interpret that
anomaly correctly.

**3. Self-terminating behaviour under a bounded budget.** The model decides when
to stop investigating and produce output. Termination is not externally imposed
at the normal exit. A ceiling of six turns exists solely as a divergence guard,
and on reaching it the tools are withdrawn and the model is compelled to write,
so the failure mode is a less-informed analysis rather than a null result.

**4. Absent by design: agency over outcomes.** The model possesses no write
capability, no authority over the advisory state, and no ability to introduce or
suppress an indicator. `buildFraudAdvisory` computes `state` and freezes the
indicator set *before* the reasoner is invoked. The reasoner receives a completed
advisory as a fact to be explained.

The fourth point is the substantive contribution. An architecture in which a
language model can alter a fraud determination is one in which a hallucination
can precipitate an investigation of a real person. The agency is therefore placed
exclusively on the investigative axis and withheld entirely from the decisional
one.

## A3. Containment mechanisms

Three independent mechanisms constrain the agent. Each is designed to fail closed.

### A3.1 Allowlist construction of the model's information set

Both channels through which data reaches the model are constructed by
**allowlist**, not by redaction.

The prompt payload (`buildPromptPayload`) is assembled from an enumerated set of
permitted fields rather than derived by deleting prohibited ones from a claim
object. Tool return values (`priorClaimView`, `fraudTools.js`) are similarly
projected onto a fixed field list.

The rationale is failure semantics. A redaction approach fails silently the
moment an identifying field is added upstream, since the deletion list is not
updated in step. An allowlist approach fails closed: a newly added field is
simply absent from the model's view until deliberately admitted.

No name, address, barangay, age, sex, nationality, occupation, income, source of
funds, government identification number, plate number, or email address reaches
the model through either channel. The model is instructed to refer to the subject
only as "the claimant" and is told it has not been informed of their identity.

This is not incidental privacy hygiene. It removes the possibility of demographic
reasoning entering the explanation an adjuster reads, and it is the mechanical
expression of guardrail 6.

### A3.2 Evidence fencing of the retrieval tool

`lookupPriorClaim` is restricted to the set of claim identifiers that the
deterministic rule layer has already cited as evidence (`citedClaimIds`). The
allowlist is derived from the finished advisory, so nothing the model asserts can
widen it.

The alternative, an unfenced claims lookup, would permit retrieval of records
belonging to persons unrelated to the claim under review on the basis of a
hallucinated identifier. In a module whose output can direct an investigation
toward a real individual, this is not an acceptable failure mode.

Refused calls are recorded in the investigation trail with `refused: true` rather
than discarded. An attempt to open an uncited claim is information the reviewing
adjuster is entitled to see.

### A3.3 Post-hoc grounding verification

`fraudGrounding.js` extracts every currency figure and claim identifier from the
model's prose and verifies each against the union of the prompt payload and all
tool results. Values without provenance are marked as untraceable in the
interface.

**The limitation of this check must be stated precisely, and it is stated in the
source file.** It detects *fabricated* values, meaning figures appearing nowhere
in the source data. It does not detect *misrelated* values, meaning individually
authentic figures combined into a false proposition.

The motivating defect was observed in testing: the model wrote that the claimant
had "a cumulative history of PHP 375,000 across 4 prior claims." The figure
₱375,000 is the total across five claims, the four priors plus the claim under
review. Both constituent values are authentic; their conjunction is false. The
grounding check passes this sentence cleanly.

Consequently, a clean grounding result warrants only the claim that *every figure
present exists in the source data*. It does not warrant the claim that the
analysis is correct, and it is not presented as doing so.

Documenting a control's blind spot alongside the control is itself a defensible
practice and should be presented as such.

## A4. Resilience architecture

Agentic execution consumes substantially more model quota than single-shot
generation, since each advisory issues several calls rather than one. Quota
exhaustion therefore became a routine rather than exceptional condition during
development.

`MODEL_LADDER` addresses this by attempting four models in descending order of
capability. The mechanism exploits the fact that Gemini quotas are enforced
per-model: a 429 response on the primary model carries no implication for the
next, so descending the ladder yields a genuinely distinct allowance rather than
four attempts against the same limit.

Retry is restricted to statuses indicating service-side conditions (429, 500,
502, 503, 504). Statuses indicating a malformed request or invalid credential
(400, 401, 403, 404) are deliberately excluded, since every model would reject
such a request identically and retrying would obscure the true cause behind four
redundant failures.

Retry operates at the granularity of the complete agent run rather than the
individual call. The loop accumulates a transcript containing the model's own
function calls; substituting a model mid-conversation would present the successor
with a record of another model's tool use as though it were its own.

Degradation is graceful and asymmetric by design: when every model fails, the
deterministic rule output renders in full and the AI panel displays an explicit
unavailability notice. A missing explanation degrades comprehension; it must
never degrade the warning, and it is never substituted with generated-sounding
prose the model did not produce.

## A5. Interaction with human authority

The module is **non-blocking**. It cannot disable the approve action, cannot lock
a payout, and reads and writes no payout field. Where the advisory state is
`NOT_CLEARED`, approval is intercepted once to require a written acknowledgement,
which is persisted with a snapshot of the indicator codes as they stood at the
time of approval.

The acknowledgement record serves two functions. Immediately, it converts the
warning from decorative to consequential without transferring authority from the
adjuster. Prospectively, it constitutes the mechanism by which a labelled dataset
would accumulate in production, since each record pairs a set of indicators with a
qualified human's assessment of them.

## A6. Claims that can and cannot be defended

**Defensible:**
- The system implements autonomous tool selection, multi-turn state-carrying
  execution, and self-terminating investigation.
- Model agency is confined to the investigative axis and structurally excluded
  from the decisional axis.
- The model's information set is constructed by allowlist on both channels and
  contains no identifying attributes of any person.
- Retrieval is fenced to rule-cited evidence, and refusals are surfaced rather
  than suppressed.
- Numerical fabrication is detected post-hoc; the check's blind spot is
  documented rather than concealed.

**Not defensible, and must not be asserted:**
- That the system detects fraud. It surfaces patterns for human review.
- That a clean grounding result validates the analysis. It validates provenance
  of figures only.
- That thresholds are calibrated. They are set by judgement; no labelled outcome
  data exists against which to calibrate them.
- That the history signal is complete. It is single-carrier only; a claimant
  filing across multiple insurers is invisible absent an industry registry such
  as MCIS.
- That severity-based valuation is authoritative. `FR-03a` depends on a severity
  value produced by an image model rather than a physical inspector.

---

# PART B: The Plain Version

## B1. What the thing does, in four sentences

A claim comes in. Fourteen dumb-but-reliable rules check it for date
contradictions, look up the claimant's past claims, and compare the repair cost
against how bad the damage actually looks. If any of those rules trip, the claim
is marked **Not Cleared** and an AI is asked to explain why, and the AI is allowed
to dig around in the evidence first. The adjuster reads the explanation and
decides, because the system never decides anything.

## B2. Why it is an "agent" and not just an AI call

Normal AI call:
```
here is a bunch of data → write me a paragraph
```

What we do:
```
here is the advisory → AI: "let me see prior claim DEMO-HIST-0003"
                     → we hand it that claim
                     → AI: "what does FR-02e actually test?"
                     → we hand it the definition
                     → AI: "ok, here's my analysis"
```

The AI chooses what to look at. We do not script it. That is the whole difference.
Two claims with the same flags can produce completely different investigations,
because the model asked different questions.

It gets three tools:

| Tool | What it does |
|---|---|
| `lookupPriorClaim` | Open one of the claimant's past claims |
| `listClaimDocuments` | See what documents are actually on file |
| `getRuleDefinition` | Look up what a rule really tests |

That third one matters more than it sounds. Without it the AI guesses at what
"FR-02e" means and writes a confident wrong explanation. With it, it checks.

## B3. The one rule you must not break

**The rules decide. The AI explains.**

`fraudAdvisor.js` works out Cleared / Not Cleared and locks the indicator list
**before** the AI is ever called. The AI gets handed a finished decision and its
only job is to write about it. It cannot:

- flip Cleared to Not Cleared or back
- add a flag
- remove a flag
- write anything to the database
- see the payout

Why: if the AI could change the state, one hallucination sends a real person to
an investigation. So we gave it a magnifying glass and no pen.

If you are adding to this module and you find yourself letting the AI influence
`state`, stop. That is the line.

## B4. Three things that will confuse you when you read the code

### The AI never learns the claimant's name

Not "we delete the name before sending." We **build the payload from a list of
allowed fields**. Same for anything a tool returns.

The difference matters. If someone adds `assured_middle_name` to the schema next
month, a delete-list quietly leaks it. An allow-list just does not include it.

Practical effect: the AI writes "the claimant" everywhere because it genuinely
does not know who it is.

### The AI can only open claims the rules already named

`lookupPriorClaim` checks the requested id against `citedClaimIds(advisory)`,
which is built from the evidence the rules produced. Ask for anything else and it
gets refused.

Without this, a hallucinated claim id would let the model pull up a stranger's
record. And when it does get refused, we log the refusal into the trail so you
can see it tried.

### The grounding check does less than the name suggests

`fraudGrounding.js` pulls every peso figure and claim id out of the AI's text and
asks "was this number in the data we gave it?" Anything that was not gets marked
untraceable on screen.

**It catches made-up numbers. It does not catch real numbers glued together
wrongly.**

Real example from testing: the AI wrote "₱375,000 across 4 prior claims."
₱375,000 is real. 4 is real. But ₱375,000 is the total across *five* claims
(4 priors + the current one). The check passes it. It has no idea the sentence is
wrong.

So do not tell anyone "grounded means correct." Grounded means "these numbers
exist somewhere in the input."

## B5. Why there are four models

The agent makes several API calls per claim instead of one, so it burns free-tier
quota fast. When we hit 429 the whole AI box went grey.

Gemini quotas are per-model. So a 429 on `gemini-3.6-flash` tells you nothing
about `gemini-2.5-flash`. `MODEL_LADDER` just tries the next one down.

Order is best-first, biggest-quota-last. We only retry on 429/500/502/503/504. We
do **not** retry on 400/401/403/404, because those mean *we* sent something wrong
and all four models will reject it identically. Retrying would just hide the real
error behind four copies of itself.

And if all four fail? The rules output still renders completely. You get a grey
"AI unavailable" notice instead of the analysis. We never fake a paragraph.

## B6. When does it actually run

Four triggers, all in `App.jsx`:

1. You open a claim that has no advisory yet
2. You save an OCR correction
3. You upload or replace a document
4. You hit the ↻ button on the card

Triggers 2 and 3 exist because the advisory is **stored in Mongo, not computed on
render**. So it can go stale. Fix a wrong accident date and the card has to re-run
or it sits there showing a verdict on data you already replaced.

## B7. The warning does not block anything

No disabled approve button. No locked payout. If the advisory says Not Cleared and
you click Approve, you get one modal asking you to type why, and then you approve.

That is deliberate. Most of what trips this module is claim frequency, and
frequent claims are not fraud. Blocking a payout over a frequency count would be
asserting something the data cannot support.

The acknowledgement gets saved with a snapshot of which indicators were live at
the time. That is our audit trail, and eventually it is the training data.

## B8. Where to start reading

```
backend/src/services/
├── fraudAdvisor.js       ← START HERE. the orchestrator, ~200 lines
├── fraudRules/
│   ├── temporalRules.js    FR-01, dates vs each other
│   ├── historyRules.js     FR-02, the claimant's past claims
│   └── valuationRules.js   FR-03, repair cost vs damage severity
├── claimantIdentity.js   ← how we know two claims are the same person
├── fraudReasoner.js      ← the agent loop + model ladder
├── fraudTools.js         ← the three tools + the fence
└── fraudGrounding.js     ← the fabrication check
```

Read `fraudAdvisor.js` first. It is short and every other file hangs off it.

---

# PART C: The Agentic Tree

## C1. Full control flow

```
TRIGGERS  (frontend/src/App.jsx)
│
├── [T1] Adjuster opens a claim with no fraudAdvisory      (line ~283)
├── [T2] Adjuster saves an OCR correction                  (lines ~355, ~683)
├── [T3] Adjuster uploads or replaces a document           (line ~531)
└── [T4] Adjuster clicks ↻ Re-run on the advisory card     (line ~941)
                    │
                    ▼
        POST /api/claims/:claimId/fraud-review
                    │
                    ▼
        ┌───────────────────────────────────────────┐
        │  buildFraudAdvisory()   fraudAdvisor.js   │
        └───────────────────────────────────────────┘
                    │
    ╔═══════════════▼═══════════════════════════════════════════╗
    ║  STAGE 1 — GATHER                                         ║
    ╚═══════════════════════════════════════════════════════════╝
                    │
        findClaimantHistory()   claimantIdentity.js
                    │
        resolve identity key, strongest basis first:
            ├── government_id   (high confidence)
            ├── plate           (medium — follows the CAR not the person)
            ├── name + email    (medium)
            └── name only       (low)
                    │
        query Claim collection, same key, 5-year window,
        exclude self, project to safe fields only
                    │
        ┌───────────┴───────────┐
        │                       │
    success                 throws
        │                       │
        │                       └──▶ FR-02 family → skipped[]
        │                            with the error text.
        │                            NOT treated as "no history".
        │                            Advisory continues.
        ▼
    ╔═══════════════════════════════════════════════════════════╗
    ║  STAGE 2 — EVALUATE  (deterministic, no AI)               ║
    ╚═══════════════════════════════════════════════════════════╝
        │
        ├── evaluateTemporalRules()    FR-01a…f   dates
        ├── evaluateHistoryRules()     FR-02a…f   prior claims
        └── evaluateValuationRules()   FR-03a…b   cost vs damage
                    │
        each rule → one of four outcomes:
            ├── fired        → has evidence, counts
            ├── suppressed   → fired, then a suppression rule cancelled it
            │                  (FR-01e ×2, FR-02a dispersion)
            │                  VISIBLE in the UI, never hidden
            ├── skipped      → required input missing. NOT a pass.
            └── silent       → evaluated, did not fire
                    │
        map FR-01 severities:  hard → indicator,  soft → observation
                    │
    ╔═══════════════▼═══════════════════════════════════════════╗
    ║  STAGE 3 — DECIDE   ← the AI is NOT here                  ║
    ╚═══════════════════════════════════════════════════════════╝
                    │
        state = indicators.length > 0 ? NOT_CLEARED : CLEARED
                    │
        concern (triage ordering only, never acted on):
            0 indicators                    → LOW
            1 indicator                     → MODERATE
            2+ indicators, or FR-02e/FR-02f → HIGH
                    │
        headline built mechanically from the rule output.
        NOT written by the AI — it is the most prominent line
        on the card and must not drift.
                    │
        ┌───────────┴───────────┐
        │                       │
    CLEARED                NOT_CLEARED
        │                       │
        │ ai = null             ▼
        │ (nothing to     ╔═══════════════════════════════════╗
        │  explain,       ║  STAGE 4 — INVESTIGATE (agentic)  ║
        │  saves quota)   ╚═══════════════════════════════════╝
        │                       │
        │           generateFraudReasoning()   fraudReasoner.js
        │                       │
        │           buildPromptPayload()  ← ALLOWLIST rebuild
        │           indicators, observations, suppressed,
        │           claim type, amount, history summary.
        │           NO name / address / age / sex / ID / plate / email
        │                       │
        │           buildFraudTools()  ← fence built from
        │           citedClaimIds(advisory)
        │                       │
        │      ┌────────────────▼────────────────┐
        │      │   MODEL LADDER (best first)     │
        │      │   1. gemini-3.6-flash           │
        │      │   2. gemini-3.5-flash           │
        │      │   3. gemini-2.5-flash           │
        │      │   4. gemini-3.5-flash-lite      │
        │      └────────────────┬────────────────┘
        │                       │
        │      ┌────────────────▼──────────────────────────────┐
        │      │  runAgent()  —  loop, max 6 turns             │
        │      └───────────────────────────────────────────────┘
        │                       │
        │            ┌──────────▼──────────┐
        │            │  call Gemini        │◀────────────┐
        │            └──────────┬──────────┘             │
        │                       │                        │
        │         did it request tools?                  │
        │            ┌──────────┴──────────┐             │
        │           YES                    NO            │
        │            │                     │             │
        │            ▼                     ▼             │
        │   ┌─────────────────┐     parse JSON           │
        │   │ execute each    │          │               │
        │   │ tool call       │     ┌────┴────┐          │
        │   └────────┬────────┘   ok         bad         │
        │            │             │           │         │
        │   ┌────────▼──────────┐  │           └─▶ next  │
        │   │ lookupPriorClaim  │  │              model   │
        │   │  └─ FENCE: id     │  │                      │
        │   │     must be       │  ▼                      │
        │   │     rule-cited    │ ┌──────────────────┐    │
        │   │  └─ refused calls │ │ checkGrounding() │    │
        │   │     go in trail   │ │ every ₱ and id   │    │
        │   ├───────────────────┤ │ traced to source │    │
        │   │ listClaimDocuments│ └────────┬─────────┘    │
        │   │  └─ type + title  │          │              │
        │   │     only, no      │          ▼              │
        │   │     filenames     │      ai = { summary,    │
        │   ├───────────────────┤           reasoning,    │
        │   │ getRuleDefinition │           riskFraming,  │
        │   │  └─ what a rule   │           suggestedChecks,
        │   │     really tests  │           trail,        │
        │   └────────┬──────────┘           grounding }   │
        │            │                                    │
        │      append to trail                            │
        │      append results to transcript ──────────────┘
        │            │
        │      turn == 6?
        │            │
        │           YES ──▶ withdraw tools, force a write
        │                   (bounded loss, not a null result)
        │
        │      every model failed?
        │            │
        │           YES ──▶ ai = { unavailable: true, reason, trail }
        │                   RULES STILL RENDER IN FULL.
        │                   Never a fabricated paragraph.
        │                   Never a silent CLEARED.
        │
        └───────────┬───────────┘
                    ▼
        persist advisory to claim.fraudAdvisory
        return full claim
                    │
    ╔═══════════════▼═══════════════════════════════════════════╗
    ║  STAGE 5 — PRESENT                                        ║
    ╚═══════════════════════════════════════════════════════════╝
                    │
        FraudAdvisory.jsx renders:
            state chip · concern chip · headline
            disclaimer bar          (fixed copy, NOT_CLEARED only)
            AI Analysis box         (summary, reasoning,
                                     "why this may still be legitimate",
                                     suggested checks, tool trail,
                                     grounding notes)
            indicators              (+ View evidence → jumps the doc viewer)
            observations            (collapsed)
            suppressed              (visible, with reason)
            not evaluated           (visible, with what was missing)
            footer                  (engine version, identity basis)
                    │
    ╔═══════════════▼═══════════════════════════════════════════╗
    ║  STAGE 6 — HUMAN DECIDES  ← the only decision point       ║
    ╚═══════════════════════════════════════════════════════════╝
                    │
        Approve clicked
                    │
        state == NOT_CLEARED?
            ┌───────┴───────┐
           NO              YES
            │               │
            │               ▼
            │      FraudAcknowledgementModal
            │      required written note
            │               │
            │      ┌────────┴────────┐
            │      │                 │
            │  Review           Acknowledge
            │  indicators       and approve
            │      │                 │
            │      └─▶ back to card  │
            │                        ▼
            │            persist fraudAcknowledgement
            │            { note, acknowledgedAt,
            │              advisoryState,
            │              indicatorCodes snapshot,
            │              engineVersion }
            │                        │
            └────────────┬───────────┘
                         ▼
                     APPROVED
                (payout untouched by
                 anything above)
```

## C2. Where agency starts and stops

```
                    AGENCY MAP

  ┌──────────────────────────────────────────────────┐
  │  DETERMINISTIC — the model has no part in this   │
  │                                                  │
  │  identity resolution                             │
  │  history retrieval                               │
  │  all 14 rules                                    │
  │  suppression                                     │
  │  state       CLEARED / NOT_CLEARED               │
  │  concern     LOW / MODERATE / HIGH               │
  │  headline                                        │
  └──────────────────────────────────────────────────┘
                        │
                        │  handed over, frozen
                        ▼
  ┌──────────────────────────────────────────────────┐
  │  AGENTIC — the model chooses freely              │
  │                                                  │
  │  which tools to call                             │
  │  what arguments to use                           │
  │  in what order                                   │
  │  how many turns to take (≤6)                     │
  │  when it has read enough                         │
  │  what to write                                   │
  └──────────────────────────────────────────────────┘
                        │
                        │  output is prose only
                        ▼
  ┌──────────────────────────────────────────────────┐
  │  HUMAN — the only actor with authority           │
  │                                                  │
  │  approve / deny / adjust payout                  │
  │  dismiss or act on any indicator                 │
  │  correct the data and re-run                     │
  └──────────────────────────────────────────────────┘
```

## C3. Every failure path

Useful for the defence, because "what happens when the AI breaks" is a certain
question.

| Failure | Behaviour | Adjuster sees |
|---|---|---|
| History lookup throws | FR-02 family → `skipped` | "not evaluated" with the reason |
| Rule input missing | That rule → `skipped` | "not evaluated" with what was missing |
| No API key | Ladder not attempted | Rules in full + AI unavailable notice |
| Model returns 429 | Step down the ladder | Analysis, plus a "fell back" note |
| Model returns 400/401/403 | No retry, fail immediately | Rules in full + the real reason |
| Response is not JSON | Retry on next model | Analysis, or unavailable notice |
| Response missing fields | Retry on next model | Analysis, or unavailable notice |
| Model asks for an uncited claim | Tool refuses, run continues | The refusal, in the trail |
| Model loops past 6 turns | Tools withdrawn, forced write | Analysis, possibly less specific |
| All four models fail | `ai.unavailable` | Rules in full + notice + partial trail |
| Model fabricates a figure | Grounding flags it | "untraceable" marker on the value |
| Model misrelates real figures | **Not caught** | Nothing. Known blind spot. |

The last row is the honest one. Say it out loud before someone finds it.

## C4. Triggers, precisely

| # | Trigger | Why it exists |
|---|---|---|
| T1 | Opening a claim with no advisory | First run. Not awaited, so the workspace renders immediately and the card shows "not yet run" until it lands |
| T2 | Saving an OCR correction | The advisory is **stored, not derived**. Fixing an accident date must move the result, otherwise the card shows a verdict on replaced data |
| T3 | Uploading or replacing a document | New extraction means a new estimate total, severity, or part list, which FR-02e and FR-03 read |
| T4 | Manual ↻ on the card | Escape hatch. Also how you demo the agent live |

An existing advisory is never silently recomputed on render. Re-running is always
either explicit (T4) or caused by a data change (T2, T3), which is what makes the
result reproducible during a demo.
