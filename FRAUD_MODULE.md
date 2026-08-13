# InsureCopilot — Fraud Advisory Agent

Reference for the fraud module as it stands after the 12–13 August 2026 work.
Written to be read before a defence: what it does, how it does it, what you can
honestly claim about it, and what you must not.

Branch: `fraud-test`. Guardrails live in `CLAUDE.md` at the repo root and are
binding on any future change.

---

## 1. In one paragraph

The module reads a claim, gathers deterministic signals from three rule families,
and decides one thing: **Cleared** or **Not Cleared** — is there anything here a
human should look at before approving? If there is, a tool-using Gemini agent
investigates the evidence and writes the explanation. The rules decide; the AI
explains. The warning never blocks the adjuster, never touches the payout, and
never says the word "fraud" as a finding.

---

## 2. What changed today, and why

### It was a detector. It is now an advisor.

The original FR-01 module scored a claim 0–100, banded it CLEAR / VERIFY /
REFER, and REFER meant *"payout locked, refer to the Special Investigation
Unit."* That framing could not be defended, and the reason is the single most
important argument in the whole project:

> The module's primary signal is **claim frequency**. Frequency is a
> well-established *trigger for investigation* and equally well established as
> **not** being evidence of deception. A policyholder with four legitimate claims
> from four separate verifiable events is a **high-risk customer**, not a
> fraudster. Fraud requires intentional deception for financial gain, and nothing
> in a count of claims can establish intent.

A module built on frequency can therefore only **warn**. A score implies a
measurement the data cannot support; a locked payout implies a verdict the data
cannot support. Both are gone.

**Frame this as the finding, not as a scope cut.** Building it as a blocking
detector would have been the easier implementation and the wrong one.

### The four stages of today's work

| Stage | What it added |
|---|---|
| **Advisory** | Backend evaluation, claimant history (FR-02), valuation cross-check (FR-03), binary state, non-blocking acknowledgement |
| **Agentic** | Three read-only tools, a real agent loop, a visible investigation trail |
| **Resilient** | A four-model fallback ladder, and a grounding check on the AI's prose |
| **Operable** | A Reopen button, so a sealed claim can return to assessment |

---

## 3. How it works now

```
POST /api/claims/:claimId/fraud-review
        │
        ├─ 1. claimantIdentity.js ──► who filed this? find their other claims
        │
        ├─ 2. THE RULE LAYER (deterministic, no AI)
        │      temporalRules.js    FR-01  dates vs each other
        │      historyRules.js     FR-02  the claimant's prior claims
        │      valuationRules.js   FR-03  repair cost vs documented damage
        │
        ├─ 3. fraudAdvisor.js ────► state, concern, headline  ◄── DECIDED HERE
        │                            (frozen before any AI runs)
        │
        ├─ 4. IF NOT_CLEARED → fraudReasoner.js
        │      the agent loop: model calls tools, reads results,
        │      decides when it has enough, then writes
        │           └─ fraudTools.js       3 read-only, fenced tools
        │           └─ MODEL_LADDER        4 models, falls back on quota
        │
        ├─ 5. fraudGrounding.js ──► are the figures in the prose traceable?
        │
        └─ persists to claim.fraudAdvisory, returns the full claim
```

The result rides along on `GET /api/claims`, so the dashboard needs no second
call. `fraudAdvisory` is **not** in `PATCHABLE_CLAIM_FIELDS` — it is machine
output with its own route, the same treatment `documents` and `ocrData` get.

### The state rule — the entire contract

```js
const state = indicators.length > 0 ? 'NOT_CLEARED' : 'CLEARED';
```

`NOT_CLEARED` if and only if at least one **unsuppressed indicator** fired.
Observations never change it. There is no weighted sum, because a number invites
being read as a measurement.

**Concern** (LOW / MODERATE / HIGH) exists only to order a review queue. It is
not a severity of suspicion and nothing in the system acts on it.

---

## 4. The rules — 14 across three families

### FR-01 · Temporal — dates the claim asserts

| Code | Rule | Fires when | Severity |
|---|---|---|---|
| FR-01a | Incident Predates Policy Inception | Loss dated before cover began | indicator |
| FR-01b | Incident After Policy Expiry | Loss dated after cover lapsed | indicator |
| FR-01c | Cross-Document Date Conflict | Police report predates the incident, or postdates it by >3 days | indicator |
| FR-01d | Policy Freshness | Loss within 30 days of inception | observation |
| FR-01e | Delayed Reporting | Filed >14 days after the incident | observation |
| FR-01f | Repair Estimate Predates Incident | Estimate dated before the loss it quotes | indicator |

FR-01 uses `hard` / `soft` internally; `fraudAdvisor.js` maps them to
`indicator` / `observation`.

### FR-02 · Claim history — 5-year window. The primary family.

| Code | Rule | Fires when | Severity |
|---|---|---|---|
| FR-02a | Elevated Claim Frequency | ≥3 in 12mo, ≥3 in 24mo, or ≥5 in 5yr → indicator; 3–4 in 5yr → observation | tiered |
| FR-02b | Rapid Succession | Any two claims within 90 days | indicator |
| FR-02c | Elevated Cumulative Amount | Total claimed >₱250,000 | **observation only** |
| FR-02d | Frequency Combined With Amount | FR-02a at indicator level **and** FR-02c both fired | indicator |
| FR-02e | Repeated Damage Area | Same part on this claim and ≥2 priors | indicator |
| FR-02f | Prior Denied Claim | Any prior in the window was denied | indicator |

### FR-03 · Valuation — cost against documented damage

| Code | Rule | Fires when | Severity |
|---|---|---|---|
| FR-03a | Repair Cost Inconsistent With Documented Damage | Estimate exceeds the band for the stated severity — Minor ₱60k, Moderate ₱180k, Severe no ceiling | indicator |
| FR-03b | Claimed Amount Exceeds Repair Estimate | Claimed >10% above the estimate | indicator |

### The three suppressions — where the false-positive control lives

| Applies to | Withdrawn when |
|---|---|
| FR-01e | A declared natural peril (typhoon / flood) explains the delay |
| FR-01e | Late filing was declared on the claim form — a declared delay is not a concealed one |
| **FR-02a** | **Dispersion**: no two claims within 12 months, no repeated part, no prior denial |

**The rules are not independent, and that is the mechanism.** FR-02d does not
look at the claim at all — it fires only on the *combination* of two other rules.
The dispersion suppression must know whether FR-02e and FR-02f fired before it
can decide whether frequency means anything. A single-rule module cannot do this.

> **The worked example.** Pedro Ramirez and Juan Dela Cruz have filed the same
> number of claims — five in five years. Juan comes back NOT CLEARED; Pedro comes
> back CLEARED with the frequency signal visibly withdrawn. What separates them is
> not the count but the *shape*: Juan repeats a part and clusters inside 12
> months; Pedro is dispersed and hits a different part every time. That is your
> answer to "doesn't this just flag anyone who claims a lot?"

### One deviation from the written plan, and why

The source plan made the 5-year frequency tier observation-only. That left the
dispersion suppression with nothing to act on: three claims inside 24 months
means, by the pigeonhole principle, two fall within 12 months of each other, so
an indicator-level frequency hit could never satisfy the dispersion test.
Splitting the 5-year tier at ≥5 claims gives the suppression a real case — which
is the behaviour the module exists to demonstrate. Documented in
`historyRules.js`.

---

## 5. Identity resolution — the quiet load-bearing part

Every history rule depends on correctly answering "are these the same person?".
`claimantIdentity.js` resolves in strongest-evidence order:

| Order | Source | Basis | Confidence |
|---|---|---|---|
| 1 | `ocrData.motorClaimForm.assured_id_no` | `government_id` | high |
| 2 | `vehicle_plate_no` | `plate` | medium |
| 3 | policyholder name + email | `name_email` | medium |
| 4 | policyholder name alone | `name_only` | low |

**No fuzzy matching, by design.** Levenshtein or soundex would link "Maria
Santos" to "Mario Santos" sometimes correctly and sometimes not, with no way for
the agent to tell which. This module's output can lead to a real person being
investigated; a probabilistic name match cannot carry that weight.

**The demo that proves it works.** One of Juan's prior claims,
`DEMO-HIST-0002`, carries the name misspelled as **"Jan Dela Cruz"** with the
correct ID number — and is still matched. Break that ID number and his history
drops from 4 to 3 and the advisory changes. That is the strongest live
demonstration in the module.

The plate branch is a known limitation and is **surfaced, not hidden**: a plate
follows the vehicle, so a change of owner can group two different people. The
advisory card prints a caution line whenever the match basis is `plate` or
`name_only`.

---

## 6. How it is agentic — and exactly what that claims

### What is agentic

The model **chooses what to investigate**. It has three tools and decides which
to call, with what arguments, in what order, and when it has read enough.
Nothing in the code scripts that sequence.

| Tool | Returns |
|---|---|
| `lookupPriorClaim(claimId)` | Date, status, amount, detected parts for one prior claim |
| `listClaimDocuments()` | What documents are on file for the claim under review |
| `getRuleDefinition(code)` | What a rule actually tests, and its threshold |

Loop in `fraudReasoner.js`, capped at `MAX_TOOL_TURNS = 6`. On the final turn
the tools are withdrawn, forcing a written answer out of a model that would
otherwise keep investigating.

**The proof it is not a fixed pipeline** — two runs of the *same claim*:

```
run 1:  listClaimDocuments → getRuleDefinition(FR-02e) → 3× lookupPriorClaim
run 2:  getRuleDefinition(FR-02e) → listClaimDocuments → 3× lookupPriorClaim
```

The card renders this as a collapsible **Investigation** section, so it can be
watched rather than asserted. Screenshot two runs side by side.

### What is deliberately not agentic

The model has **no authority over the outcome**. It cannot change the state,
cannot add or remove an indicator, cannot write anything anywhere. The state and
the indicator list are computed and frozen *before* it is contacted, and the only
thing done with its return value is hang it off `advisory.ai`.

> **Why:** an LLM that can flip a claim's state on a hallucination can accuse a
> real person.

### The fence — the interesting engineering

`lookupPriorClaim` is restricted to **claim IDs the rules already cited**. Tested:

```
allowed   DEMO-HIST-0003    a claim the rules cited
REFUSED   CLM-2026-9001     a real claim they did not
REFUSED   DEMO-2026-0002    another claimant's claim
REFUSED   NOPE-9999         a hallucinated id
REFUSED   deleteEverything  a tool that does not exist
```

Without the fence, one hallucinated claim ID pulls an unrelated person's record
into a fraud assessment. Refused calls are recorded in the trail as loudly as
successful ones.

---

## 7. The guardrails, and how each is actually enforced

Guardrails are in `CLAUDE.md`. What matters for a defence is that most are
**structural** — enforced by what the code is given, not by a prompt asking
nicely.

| # | Guardrail | Enforcement |
|---|---|---|
| 1 | Never states a claim is fraudulent | Wording checked mechanically in `check:fraud` against generated output, including the AI's |
| 2 | Frequency is not fraud | Non-dismissible disclaimer bar on every NOT_CLEARED card; the AI's `riskFraming` field is *required* |
| 3 | Never blocks the decision | `DecisionPanel.jsx` is passed no means to disable Approve — the acknowledgement modal records, never prevents |
| 4 | Never changes the payout | No fraud service reads or writes `approvedPayout`; asserted in the suite, including on prior-claim records |
| 5 | Rules decide, AI explains | State computed before the model is called; the model's output is only ever attached |
| 6 | No demographic inputs | Two independent allowlists — the prompt payload and the tool projections. Neither trusts the other |
| 7 | Every signal carries evidence | A rule with nothing to cite does not fire; missing inputs report as *not evaluated*, never as passing |
| 8 | Fraud output in its own object | `fraudAdvisory` never merges into `claim.rules`; violet palette never touches the policy card's green/amber/red |
| 9 | Nothing reaches the claimant | `EmailModal.jsx` has no fraud reference and depends only on approve/deny |

**Guardrail 7 is worth demonstrating.** Your live `CLM-*` claims have no
`createdAt`, so they report a dozen rules as *not evaluated* rather than
returning a clean result. An engine that reported CLEARED because it had nothing
to read would be worse than no engine.

---

## 8. Resilience — the two things added last

### The model ladder

The agent makes 3–8 calls per advisory instead of one, so it exhausts a free-tier
quota fast. **Gemini quotas are per-model**, so falling back gets a genuinely
fresh allowance:

```
gemini-3.6-flash  →  gemini-3.5-flash  →  gemini-2.5-flash  →  gemini-3.5-flash-lite
```

Falls back on 429 / 500 / 502 / 503 / 504, timeouts and network failure. **Never**
on 400 / 401 / 403 / 404 — those mean our request is wrong and every model would
reject it identically. All four candidates were verified to support function
calling, so the agent survives the downgrade intact. The whole run retries per
model rather than the individual call, so no model is handed a transcript of
another model's tool use. The card shows an amber `↓ model` badge when it fell
back, and `ai.modelAttempts` records every attempt.

### The grounding check

Every peso figure and claim ID in the model's prose is traced back to the facts
it was given — the prompt payload **plus every tool result**. Anything
untraceable is flagged on the card in amber. Non-blocking: it annotates, never
withholds.

The subtlety that makes it usable: **subset sums are allowed**. If the model
correctly adds Juan's four priors and writes ₱310,000, that literal appears
nowhere in the payload. Without tolerance the check would flag the model for
doing arithmetic right.

---

## 9. Demo data

`npm run seed` — idempotent, additive only, never overwrites. Your real `CLM-*`
claims are untouched. All synthetic claims carry a `DEMO-` prefix.

| Claim | Claimant | Outcome | Purpose |
|---|---|---|---|
| `DEMO-2026-0001` | Juan Dela Cruz | **NOT CLEARED · HIGH** | Frequency + amount + a rear bumper claimed four times |
| `DEMO-2026-0002` | Maria Santos | CLEARED · LOW | Clean baseline |
| `DEMO-2026-0003` | Pedro Ramirez | **CLEARED** | *The important one* — files more than Juan, still cleared |
| `DEMO-2026-0004` | Andrea Lim | NOT CLEARED · MODERATE | Zero history; ₱240k estimate on Minor damage |
| `DEMO-HIST-0001…9` | — | — | Nine closed priors, never opened in the UI |

**The `createdAt` trap.** Mongoose `timestamps: true` overwrites `createdAt` on
save, which would put every historical claim in the same week and silently break
every window rule. The seeder inserts through the raw driver to avoid this. It is
the single most likely way this data could look right and be wrong.

---

## 10. Verification

```bash
cd backend
npm run check:temporal   # 9 FR-01 cases, no database needed
npm run check:fraud      # 51 checks against stsp_db
```

Covers identity resolution, all four demo outcomes, degradation, every
mechanically-checkable guardrail, the tool fence, the model ladder, the grounding
check, and the reopen flow. Run these **first** — if they are green, anything
that then looks wrong in the browser is a UI problem, not an engine one.

Full 27-step manual protocol: the Fraud Advisory Test Protocol artifact.

### The four worth demonstrating live

1. **Identity matching does not rely on names** — the misspelled `DEMO-HIST-0002`.
2. **Frequency is not treated as fraud** — Pedro, cleared with the suppression shown.
3. **A failed AI call degrades the explanation, never the warning** — unset
   `GEMINI_API_KEY` and re-run; indicators render in full, no invented paragraph.
4. **The claimant's identity never reaches the model** — the backend logs the exact
   outbound payload; search it for the name, ID number, plate or email.

---

## 11. What to say — the claims you can defend

**On the design:**
> The design follows from the data. Claim frequency is a well-established
> investigation trigger and equally well established as not being evidence of
> fraud, therefore a frequency-driven module can only warn. Building it as a
> blocking detector would have been the easier implementation and the wrong one.

**On the AI:**
> The AI performs tool-grounded reasoning over facts it retrieves from the claims
> database and produces a structured explanation with suggested next actions. It
> cannot determine the outcome, cannot introduce an indicator, and receives no
> identifying information about the claimant.

**On false positives:**
> The dispersion suppression and the observation-versus-indicator split are the
> two mechanisms stopping this from behaving like a rules-only system, which the
> literature puts at 60–85% false positive rates. Pedro Ramirez is the worked
> example.

**On the human-in-the-loop:**
> The warning is non-blocking by construction, not by convention — the decision
> panel is passed no means to block. The agent may be asked to acknowledge the
> advisory in writing, and that acknowledgement is snapshotted with the indicator
> codes as they stood at approval time.

---

## 12. What NOT to claim

**Do not say the system does not hallucinate.** It can. The guardrails bound the
*blast radius*, not the fabrication:

| Structurally impossible | Still possible |
|---|---|
| Changing CLEARED / NOT CLEARED | Misstating a figure in the prose |
| Adding or removing an indicator | Attributing a part to the wrong prior claim |
| Seeing the claimant's identity | Suggesting a document that does not exist |
| Reading an uncited claim | Overstating what the evidence shows |

**Observed in testing:** the model wrote *"cumulative history of ₱375,000 across
4 prior claims."* ₱375,000 is the total across **five** claims — the four priors
plus the current one. Both numbers are real; only the joining of them is false.
**The grounding check passes this cleanly**, because it catches *fabricated*
values, not *misrelated* ones. Detecting that needs semantic verification, which
is out of scope.

So: a clean grounding result means "every figure here exists in the source data".
It does **not** mean "this analysis is correct".

### The other honest limitations

- **Single-carrier history only.** A claimant filing with several insurers is
  invisible without an industry database such as MCIS.
- **Vision severity drives FR-03a** and is model-produced, not from an inspector.
  A wrong severity read produces a wrong signal — the detail text says so.
- **Thresholds are judgement, not calibration.** ₱250,000, 90 days, the
  ₱60k/₱180k bands, ≥5 in 5 years — chosen by reasoning about Philippine motor
  claims, not fitted to labelled outcomes. They are exported as named constants
  so they can be cited and tuned. The acknowledgement log is the mechanism by
  which real labelled data would accumulate.
- **FR-01a/b/d always report *not evaluated*** — policy inception and expiry
  dates exist nowhere in the data model, and `policyRegister.js` is empty by
  design rather than inventing them. Correct failure mode, but state it before
  someone frames it as a bug.
- **Reopening clears the fraud acknowledgement.** A deliberate trade for demo
  repeatability. A production version would move the withdrawn decision into a
  history array rather than deleting it.

### Future work, in priority order

MCIS or industry-registry lookup → network analysis across shared repair shops,
payees and witnesses → image forensics (EXIF, perceptual-hash duplicates,
AI-generated image detection) → threshold calibration once acknowledgement data
exists.

---

## 13. File map

**Backend**

| File | Role |
|---|---|
| `src/services/claimantIdentity.js` | Identity resolution + history lookup |
| `src/services/fraudRules/temporalRules.js` | FR-01 (+ `.selftest.mjs`) |
| `src/services/fraudRules/historyRules.js` | FR-02 + dispersion suppression |
| `src/services/fraudRules/valuationRules.js` | FR-03 |
| `src/services/fraudAdvisor.js` | Orchestrator — state, concern, headline |
| `src/services/fraudTools.js` | The three tools + the fence |
| `src/services/fraudReasoner.js` | The agent loop + the model ladder |
| `src/services/fraudGrounding.js` | Traces figures back to source data |
| `src/server.js` | `POST /api/claims/:id/fraud-review`, schema |
| `scripts/seedClaims.js` | Demo data |
| `scripts/checkFraudAdvisory.js` | The 51-check suite |

**Frontend**

| File | Role |
|---|---|
| `components/claims/FraudAdvisory.jsx` | The advisory card, trail, grounding notice |
| `components/modals/FraudAcknowledgementModal.jsx` | Approve-over-advisory |
| `components/claims/DecisionPanel.jsx` | Decision bar + Reopen |
| `services/api.js` | `runFraudReview` |

---

## 14. Commands

```bash
# run it
cd backend  && npm run dev      # http://localhost:5001
cd frontend && npm run dev      # http://localhost:5173

# data
npm run seed                    # idempotent; safe to re-run
npm run inspect                 # read-only view of stsp_db

# verify
npm run check:temporal          # 9 cases
npm run check:fraud             # 51 checks

# run an advisory by hand
curl -X POST http://localhost:5001/api/claims/DEMO-2026-0001/fraud-review
```

Reset a decided claim with the **↺ Reopen** button on its card.

---

*One correction for the record: commit `f2fb62c` says the model ladder is defined
in the fraudGrounding service. It is defined in `fraudReasoner.js` as
`MODEL_LADDER`. Worth knowing if you cite the commit history in the paper.*
