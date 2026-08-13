# InsureCopilot: Fraud Advisory Agent
## Claude Code Implementation Plan (v2, replaces the FR-01 plan)

Branch: `fraud-test`
Stack as built: Vite + React frontend, Express + Mongoose backend, MongoDB Atlas, Gemini for OCR.

This plan **supersedes** `CLAUDE-CODE-PLAN-fraud-module.md`. Keep that file for
reference, but do not follow it any further. The direction has changed.

---

## What is changing and why

### The old design
FR-01 was a **detector**. Deterministic temporal rules produced a 0-100 score, a
three-band verdict (CLEAR / VERIFY / REFER), and REFER locked the payout and forced
an SIU referral. It runs entirely client-side.

### The new design
The module becomes an **advisor**. It reads the claims database for the claimant's
own history, gathers rule-based signals, has an AI write the reasoning, and presents
the result to the human insurance agent as a **warning**, not a verdict. The agent
stays free to approve.

### Why the change is correct, not just a scope cut

The primary new signal is claim frequency. Claim frequency **cannot** support a fraud
determination, and this is well established:

- A policyholder with four legitimate claims from four separate verifiable events is
  a **high-risk** customer. That is not fraud. Fraud requires intentional deception
  for financial gain.
- Frequency is a **trigger for investigation**, which is exactly how carriers use
  contributory databases. It is an input to a human decision, never the decision.

So a module built on frequency must warn, not judge. Any UI that renders a frequency
signal as a verdict is making a claim the underlying data cannot support, and that is
the first thing a panel will attack. Building it as an advisory is the stronger
engineering answer, and it should be argued that way in the paper rather than
presented as a simplification.

### Summary of concrete changes

| Area | Old | New |
|---|---|---|
| Primary signal | Temporal inconsistency | Claimant claim history (frequency first, amount second) |
| Where it runs | Frontend, pure function | Backend endpoint, queries Mongo |
| Output | Score 0-100, three bands | Binary state (Cleared / Not Cleared) + concern level for triage |
| Effect on decision | Locks payout, forces SIU referral | Non-blocking warning, agent must acknowledge |
| Explanation | Templated detail sentences | AI-generated reasoning over gathered facts |
| Framing | "Refer to Special Investigation Unit" | "Potential fraud indicators, recommended for agent review" |
| FR-01 temporal rules | The whole module | Retained, folded into the same advisory output |

---

## Section 1: Replace `CLAUDE.md` at the repo root

The existing `CLAUDE.md` guardrails were written for a detector. Several of them are
now wrong. Replace the fraud section entirely with the block below.

```markdown
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
```

---

## Step 0: Seed claim history to demo against

**Why first:** every rule below reads the claims collection. With three unrelated
seeded claims there is no history to find, so nothing will fire and you will not be
able to tell a working rule from a broken one.

**Prompt:**

```
Read backend/scripts/seedClaims.js and backend/src/server.js to understand the Claim
schema and the current seed data.

Extend the seeder with prior claim history so the fraud module has something to read.
Add a second exported array HISTORICAL_CLAIMS containing closed claims. Give them
status 'Completed' or 'Denied' and realistic createdAt dates spread across the past
five years. Set decidedAt as well.

Design the history to produce four distinct demo outcomes:

CLAIMANT A — Juan Dela Cruz (current claim CLM-2026-9001)
Add 4 prior claims: roughly 44 months ago, 20 months ago, 11 months ago, 5 months ago.
Claimed amounts around 45k, 88k, 72k, 105k. Give at least two of them a
repairEstimate.detectedParts list that overlaps with the current claim (for example
'rear bumper' appearing three separate times). All Completed.
INTENT: high frequency, high cumulative amount, repeated damage area. Should end
NOT CLEARED with High concern.

CLAIMANT B — Maria Santos (current claim CLM-2026-9002)
Add 1 prior claim about 40 months ago, amount around 30k.
INTENT: clean baseline. Should end CLEARED with no signals.

CLAIMANT C — Pedro Ramirez (current claim CLM-2026-9003)
Add 4 prior claims spread evenly across 5 years, small amounts (18k to 35k), all
different damage areas, none within 12 months of each other.
INTENT: this is the HIGH RISK BUT NOT FRAUD case. Frequency is elevated but the
pattern is dispersed and consistent with an unlucky driver. The engine should surface
this as a noted-but-not-raised observation, and the claim should end CLEARED.
This case exists specifically to prove the module does not treat frequency as fraud.

CLAIMANT D — seed a NEW current claim CLM-2026-9004 for 'Andrea Lim'
No prior claims at all. Set ocrData.repairEstimate.totalEstimatedCost to 240000 and
ocrData.vehicleDamagePictures.severity to 'Minor' with a damageDescription along the
lines of 'light scuffing and paint transfer on the front left bumper cover, no panel
deformation'. claimedAmount 240000.
INTENT: zero history, but the repair cost is wildly out of line with the documented
damage. Should end NOT CLEARED on the cost-versus-damage signal alone, proving the
two rule families are independent.

For every claim you add or edit, populate these identity fields consistently so the
history can be matched later:
  ocrData.motorClaimForm.assured_full_name
  ocrData.motorClaimForm.assured_id_no
  ocrData.motorClaimForm.vehicle_plate_no
Give each claimant one stable assured_id_no reused across all of their claims.
For Juan Dela Cruz ONLY, misspell assured_full_name as 'Jan Dela Cruz' on exactly one
historical claim while keeping the same assured_id_no. This is deliberate: it proves
identity matching cannot rely on names.

Make the seeder idempotent — running it twice must not duplicate claims.
Do not touch the fraud engine yet.
```

**Acceptance criteria**
- `npm run seed` twice leaves the same document count.
- `npm run inspect` shows 4 open claims and 9 historical ones.
- Juan's history contains one record with a misspelled name and a matching id number.

---

## Step 1: Identity resolution

**Why its own step:** this is where a naive implementation quietly breaks. Matching on
`policyholder` name alone would miss Juan's misspelled record, undercount his history,
and clear a claim that should have been flagged. It is also the most interesting thing
in the module to write up.

**Prompt:**

```
Create backend/src/services/claimantIdentity.js.

Export resolveClaimantKey(claim) which returns a stable identity key plus how it was
derived:
  { key: string, basis: 'government_id' | 'plate' | 'name_email' | 'name_only',
    confidence: 'high' | 'medium' | 'low' }

Resolution order, strongest first:
  1. ocrData.motorClaimForm.assured_id_no, normalised (strip spaces, dashes,
     uppercase). basis 'government_id', confidence 'high'.
  2. ocrData.motorClaimForm.vehicle_plate_no, normalised. basis 'plate',
     confidence 'medium'. Note in a comment that a plate follows the VEHICLE, not
     the person, so this can group two different owners of the same car. That is a
     known limitation and must be surfaced, not hidden.
  3. normalised policyholder name + email. basis 'name_email', confidence 'medium'.
  4. normalised policyholder name alone. basis 'name_only', confidence 'low'.

Name normalisation: lowercase, collapse whitespace, strip punctuation and common
suffixes (jr, sr, iii). Do NOT attempt fuzzy or phonetic matching. Explain in a
comment that fuzzy name matching would create false links between unrelated people
and is not acceptable for a signal that can lead to someone being investigated.

Also export findClaimantHistory(ClaimModel, claim, { years = 5 }) which:
  - resolves the key for the subject claim
  - queries the Claim collection for other claims resolving to the SAME key
  - excludes the subject claim itself by id
  - excludes claims with createdAt older than `years`
  - returns { key, basis, confidence, claims: [...], windowYears: years }
  - sorts results newest first

Return the matched claims with only the fields the rules need: id, createdAt,
decidedAt, status, claimType, claimedAmount, approvedPayout, and
ocrData.repairEstimate.detectedParts. Do not return whole documents.

Guardrail 6 applies: identity fields are used ONLY to group claims. Never pass
assured_full_name, address, age, sex, nationality, occupation, or source of funds
into any rule or any AI prompt downstream.
```

**Acceptance criteria**
- Juan resolves to `basis: 'government_id'` and returns **4** historical claims,
  including the misspelled-name one.
- Andrea Lim returns 0 with no error.
- A claim with no id number and no plate still resolves, at low confidence.

---

## Step 2: FR-02, the claim history rules

**Prompt:**

```
Create backend/src/services/fraudRules/historyRules.js.

Follow the same rule-object shape as frontend/src/services/fraudEngine.js so the two
catalogues stay consistent: { code, label, category, severity, requires, evaluate }.

Severity meanings change in this module. Document them at the top of the file:
  'observation' = a pattern worth noting. Never raises a warning on its own.
  'indicator'   = a pattern that justifies asking the agent to take a closer look.
There is no severity that means "fraud". That is deliberate.

The rules. Frequency is the priority signal, amount is secondary and mostly acts as
a compounder.

FR-02a  Elevated Claim Frequency                    indicator
  Fires on claim counts within the 5 year window. Tier the detail text:
    3 or 4 claims in 5 years              -> observation-level wording
    3 or more claims in 24 months         -> indicator
    3 or more claims in 12 months         -> indicator, strongest wording
  Only emit at severity 'indicator' for the 24-month and 12-month tiers. The bare
  5-year count is severity 'observation'.
  evidence: { priorClaimIds: [...], windowMonths, count }

FR-02b  Rapid Succession                            indicator
  Two or more claims (including the current one) filed within any 90 day window.
  evidence: the two claim ids and the gap in days.

FR-02c  Elevated Cumulative Amount                  observation
  Total claimedAmount across the window exceeds 250000.
  On its own this is only an observation. A high total across five years may simply
  mean an expensive vehicle. Say so in the detail text.
  evidence: { total, priorClaimIds }

FR-02d  Frequency Combined With Amount              indicator
  Fires only when FR-02a fired at indicator level AND FR-02c fired. This is the
  compound signal: repeat claiming AND high value together are more meaningful than
  either alone. Its detail text must state that explicitly.
  evidence: both sets.

FR-02e  Repeated Damage Area                        indicator
  The same entry in ocrData.repairEstimate.detectedParts appears in the current
  claim and in 2 or more prior claims. Normalise part names to lowercase and trim
  before comparing.
  evidence: { part, claimIds }
  This is the strongest history signal in the set, because unlike raw frequency it
  points at a specific repeating fact rather than a count.

FR-02f  Prior Denied Claim                          indicator
  Any prior claim in the window has status 'Denied'.
  evidence: { claimIds, decidedAt }

DISPERSION SUPPRESSION — required, not optional.
Add a suppression rule for FR-02a: suppress when all of the following hold:
  - no two claims in the history fall within 12 months of each other
  - no repeated damage area (FR-02e did not fire)
  - no prior denied claim (FR-02f did not fire)
reason: 'Claims are dispersed across the period with no repeating pattern. Consistent
with a high-mileage or high-exposure policyholder rather than a repeat-claiming
pattern.'
This is what makes Pedro Ramirez come back CLEARED. Add a comment saying that rule
exists specifically to stop the module treating an unlucky driver as a suspect.

Every rule must degrade safely: if history could not be read at all, report the rule
as skipped with what was missing. Never return "no signals" when the real answer is
"could not check".
```

**Acceptance criteria** (test in a Node script before wiring UI)
- Juan: FR-02a (12-month tier), FR-02c, FR-02d, FR-02e all fire.
- Maria: nothing fires.
- Pedro: FR-02a fires then is suppressed. Result carries the suppression visibly.
- Andrea: nothing fires, history empty, no crash.

---

## Step 3: FR-03, repair cost versus documented damage

This is the image-versus-cost cross-check. It needs no new data: the Vision AI
fallback already writes `ocrData.vehicleDamagePictures.severity` and
`damageDescription`, and `ocrData.repairEstimate.totalEstimatedCost` is already there.

**Prompt:**

```
Create backend/src/services/fraudRules/valuationRules.js.

FR-03a  Repair Cost Inconsistent With Documented Damage        indicator
  Inputs: ocrData.repairEstimate.totalEstimatedCost and
          ocrData.vehicleDamagePictures.severity (and damageDescription for context).

  Define an expected cost band per severity as a named, exported constant so it can
  be tuned and cited in the paper:
    Minor     -> up to 60,000
    Moderate  -> up to 180,000
    Severe    -> no upper bound, rule does not fire
  Match severity case-insensitively and accept common synonyms (light/minor,
  medium/moderate, heavy/severe/major).

  Fire when the estimate exceeds the band ceiling for the stated severity.
  detail must state the estimate, the severity, the band, and the multiple, e.g.
  'Repair estimate of ₱240,000 is 4.0x the upper bound for damage documented as
  Minor. Verify the estimate against the damage photographs.'
  evidence: { estimate, severity, bandCeiling, multiple, sourceDoc }

FR-03b  Claimed Amount Exceeds Repair Estimate                 indicator
  Fires when claimedAmount exceeds totalEstimatedCost by more than 10 percent.
  evidence: both figures and the difference.

IMPORTANT LIMITATION, and it must appear as a comment in the file AND in the
detail text the agent reads: the severity value is produced by a vision model, not
by a human inspector. A wrong severity read produces a wrong signal. This rule is a
prompt to look at the photographs, never a conclusion about the estimate. Write the
detail text so it directs the agent to the evidence rather than asserting the
estimate is inflated.

If severity is null, report the rule as skipped, not as passing.
```

**Acceptance criteria**
- Andrea Lim fires FR-03a at 4.0x.
- Claims without a severity value report FR-03a as skipped, not clear.

---

## Step 4: The advisory result model

This replaces the score and the three bands.

**Prompt:**

```
Create backend/src/services/fraudAdvisor.js. This is the orchestrator.

Export async function buildFraudAdvisory(ClaimModel, claim) returning:

{
  state: 'CLEARED' | 'NOT_CLEARED',
  concern: 'LOW' | 'MODERATE' | 'HIGH',
  headline: string,
  indicators:   [ { code, label, category, severity, detail, evidence } ],
  observations: [ ...same shape, severity 'observation' ],
  suppressed:   [ { code, label, detail, suppressionReason } ],
  skipped:      [ { code, label, missing: [...] } ],
  history: { key, basis, confidence, windowYears, claimCount, totalClaimed },
  ai: null,                       // filled in by Step 5
  evaluatedAt: ISO string,
  engineVersion: 'fraud-advisor-1.0.0'
}

STATE RULE (this is the whole contract, keep it this simple):
  state is 'NOT_CLEARED' if and only if at least one signal of severity 'indicator'
  fired and was not suppressed. Observations alone never change the state. This is
  the successor to the old soft-only floor and it exists for the same reason.

CONCERN, used only for triage ordering in the queue, never for a decision:
  LOW      0 indicators
  MODERATE 1 indicator
  HIGH     2 or more indicators, OR FR-02e fired (repeated damage area), OR FR-02f
           fired (prior denied claim)

HEADLINE: one plain sentence for the agent, generated from the rule output, not by
the AI. Examples of the required register:
  CLEARED:     'No fraud indicators found. Normal processing.'
  NOT_CLEARED: '3 potential fraud indicators found. Recommended for your review
                before approval.'
Never write a headline that asserts fraud.

FR-01 HANDLING:
Import the existing temporal rules from the frontend engine and run them here too,
mapping their old severities: 'hard' becomes 'indicator', 'soft' becomes
'observation'. Keep the FR-01 codes and detail text as they are.
To do this cleanly, move frontend/src/services/fraudEngine.js to a location both
sides can import, or duplicate the rule catalogue into
backend/src/services/fraudRules/temporalRules.js and delete the frontend copy. Pick
whichever is less disruptive and say which you chose.
[ If the group decides to drop the temporal rules entirely, skip this section and
  delete fraudEngine.js, fraudEngine.selftest.mjs, and its import in App.jsx. ]

Then add the backend route in src/server.js:
  POST /api/claims/:claimId/fraud-review
  - loads the claim, runs buildFraudAdvisory, persists the result onto the claim
    document under a new schema field `fraudAdvisory` (Mixed), returns it
  - add `fraudAdvisory` to claimSchema
  - re-running is allowed and overwrites, so a re-check after an OCR correction
    works the same way the rest of the app does

  GET /api/claims already returns whole documents, so fraudAdvisory rides along for
  free and the dashboard needs no second call.
```

**Acceptance criteria**
- `curl -X POST localhost:5001/api/claims/CLM-2026-9001/fraud-review` returns
  NOT_CLEARED / HIGH with 4 or more indicators.
- 9002 returns CLEARED / LOW.
- 9003 returns CLEARED with a populated `suppressed` array.
- 9004 returns NOT_CLEARED / MODERATE from FR-03a alone.
- Re-posting overwrites rather than appending.

---

## Step 5: The agentic reasoning layer

This is the "agentic ish" part and the AI Analysis box.

**Prompt:**

```
Create backend/src/services/fraudReasoner.js.

Export async function generateFraudReasoning(advisory, claimContext) which calls
Gemini and returns:
  {
    summary: string,           // 2 to 3 sentences for the agent
    reasoning: string,         // a short paragraph explaining the pattern
    suggestedChecks: [string], // 3 to 5 concrete next actions
    riskFraming: string,       // the high-risk vs fraud distinction for THIS claim
    model: string,
    generatedAt: ISO string
  }

Call the Gemini REST API with fetch using GEMINI_API_KEY from env. Do not add an SDK
dependency. Use the same model family already used by backend/scripts/gemini_ocr.py.
Request JSON output and parse defensively, stripping code fences if present.

THE PROMPT MUST ENFORCE THE GUARDRAILS. Include, verbatim in the system instruction:

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

Pass ONLY these into the prompt:
  - the indicator and observation objects (code, label, detail, evidence)
  - claim type, claimed amount, and the history summary (count, window, total)
  - the suppressed entries and their reasons, so the AI knows what was ruled out
NEVER pass: policyholder name, address, age, sex, nationality, occupation, source of
funds, ID numbers, or email. Assert this with a comment and strip the fields
explicitly rather than relying on the caller.

FAILURE HANDLING:
If the API key is missing, the call fails, or the response will not parse, return
  { unavailable: true, reason: '...' }
and let the advisory carry it. The rule output must still display in full. A missing
AI response degrades the explanation, never the warning.

Wire it into buildFraudAdvisory: after the rules run, if state is 'NOT_CLEARED',
call the reasoner and put the result on advisory.ai. Skip the call when CLEARED —
there is nothing to explain and it saves quota.
```

**Acceptance criteria**
- 9001 returns an `ai` object with a populated `riskFraming` that offers an innocent
  explanation.
- Unsetting `GEMINI_API_KEY` still returns the full rule output plus
  `ai.unavailable: true`.
- The outbound prompt, logged once for inspection, contains no claimant name.

---

## Step 6: The UI

**Prompt:**

```
Rework frontend/src/components/claims/ClaimIntegrity.jsx into the advisory card.
Rename the file and component to FraudAdvisory.jsx / FraudAdvisory. Update the import
in ClaimAssessment.jsx.

The card reads advisory data straight off the claim (claim.fraudAdvisory). Remove the
frontend runFraudCheck call and the fraudResults useMemo in App.jsx; the backend owns
this now. Keep handleViewFraudEvidence and keep wiring it to evidence.sourceDoc and
evidence.fieldId exactly as it works today.

LAYOUT, top to bottom:

1. HEADER
   Title 'Fraud Advisory'. On the right, a state chip:
     CLEARED     -> slate chip, 'CLEARED'
     NOT_CLEARED -> amber chip, 'NOT CLEARED'
   Next to it a small concern chip (LOW / MODERATE / HIGH).
   Keep the violet palette for the card so it stays disjoint from the green/amber/red
   policy rules card. Do not reuse 🟢🟡🔴 here.

2. HEADLINE
   advisory.headline, prominent, one line.

3. REQUIRED DISCLAIMER BAR — render this whenever state is NOT_CLEARED.
   Fixed copy, do not let it be edited away:
   'This is a warning, not a determination. Frequent or high-value claims are a
   risk pattern, not proof of fraud. Review the indicators and decide.'
   Style it as an informational bar, not an alert.

4. AI ANALYSIS BOX
   A visually distinct panel (subtle gradient or a marked border) titled
   'AI Analysis' with a small model badge.
   Render advisory.ai.summary, then advisory.ai.reasoning, then advisory.ai.riskFraming
   under a sub-heading 'Why this may still be legitimate', then
   advisory.ai.suggestedChecks as a checklist.
   If advisory.ai.unavailable, render a muted notice with the reason and nothing else.
   Do not fabricate a fallback narrative.

5. INDICATORS
   One row per indicator: code, label, category, detail, an evidence line, and a
   'View evidence' button where evidence.fieldId or evidence.sourceDoc exists.
   For history indicators the evidence line lists the prior claim ids. Make each id
   a button that opens that claim in the workspace.

6. OBSERVATIONS
   Collapsed by default under 'N observations noted (did not raise a warning)'.
   Muted styling. These are visible on purpose.

7. SUPPRESSED and 8. NOT EVALUATED
   Keep the existing rendering from ClaimIntegrity.jsx. Both stay visible.

9. FOOTER
   Engine version, evaluated timestamp, and the identity basis with confidence, e.g.
   'History matched on government ID (high confidence), 4 prior claims in 5 years'.
   Where basis is 'name_only' or 'plate', add a short caution line that the match may
   be imprecise.

Also update:
- dashboard/DashboardStats.jsx: rename the fourth card to 'Fraud Advisory' showing
  the count of NOT_CLEARED open claims.
- dashboard/ClaimTable.jsx: replace the integrity score chip with a state chip
  ('CLEARED' / 'NOT CLEARED' plus concern).
- App.jsx: rename the 'Integrity Review' tab to 'Fraud Advisory' and filter on
  fraudAdvisory.state === 'NOT_CLEARED'.
```

**Acceptance criteria**
- 9001 shows the AI Analysis box with a real "why this may still be legitimate"
  paragraph.
- 9003 shows CLEARED with the suppression visible and explained.
- The disclaimer bar is present on every NOT_CLEARED claim and cannot be dismissed.
- Clicking a prior claim id navigates to that claim.

---

## Step 7: Acknowledgement, not blocking

**Prompt:**

```
Update DecisionPanel.jsx and the backend PATCH /api/claims/:claimId.

1. REMOVE any payout locking or disabled approve button tied to the fraud module. If
   the FR-01 work introduced a disabled state or a 'Refer to SIU' button, delete
   them. The agent must always be able to approve, deny, or adjust.

2. ADD ACKNOWLEDGEMENT. When fraudAdvisory.state is 'NOT_CLEARED' and the agent
   clicks Approve, intercept once and show a small modal:
     - title 'Fraud advisory outstanding'
     - the headline and a compact list of indicator labels
     - a required free-text box: 'Note for the file: why you are approving despite
       the advisory'
     - buttons 'Review indicators' (closes, returns to the card) and
       'Acknowledge and approve'
   Do not intercept Deny or Edit Payout.

3. PERSIST. Add to claimSchema:
     fraudAcknowledgement: {
       acknowledgedBy: String,
       note: String,
       acknowledgedAt: Date,
       advisoryState: String,
       indicatorCodes: [String],
       engineVersion: String
     }
   Write it in the PATCH handler when the approve request carries an acknowledgement.
   Snapshot the indicator codes as they stood at approval time so the record does not
   change if the advisory is re-run later.

4. LOG. Push an entry into the activity feed for every advisory run and every
   acknowledgement.

5. VERIFY GUARDRAIL 9. Open EmailModal.jsx and confirm no fraud advisory field can
   reach the claimant email in any state. If any part of the FR-01 work added a
   verification-notice variant driven by the fraud state, remove that coupling. The
   email content must depend only on the approve/deny decision.

Add a comment in DecisionPanel.jsx stating that the non-blocking design is
deliberate: the advisory is built substantially on claim frequency, frequency is not
evidence of fraud, and a module that blocks a payout on that basis would be asserting
something its inputs cannot support.
```

**Acceptance criteria**
- 9001 can be approved after acknowledgement, and the note persists across a refresh.
- Approving 9002 shows no modal.
- The claimant email is identical for a CLEARED and a NOT_CLEARED approval.

---

## Verification checklist

Run this before the defense and record the results. It is your evaluation section.

| # | Test | Expected |
|---|---|---|
| 1 | Seed twice | No duplicates |
| 2 | POST fraud-review on 9001 | NOT_CLEARED, HIGH, FR-02a/c/d/e all present |
| 3 | Juan's history count | 4, including the misspelled-name record |
| 4 | Change Juan's `assured_id_no` on one prior claim, re-run | History drops to 3. Proves identity resolution is doing the work, not names |
| 5 | POST on 9002 | CLEARED, LOW, no indicators |
| 6 | POST on 9003 | CLEARED, FR-02a suppressed with the dispersion reason shown |
| 7 | POST on 9004 | NOT_CLEARED, MODERATE, FR-03a at 4.0x, history empty |
| 8 | Read the AI box on 9001 | riskFraming offers a specific innocent explanation |
| 9 | Unset GEMINI_API_KEY, re-run 9001 | Indicators still render in full, AI box shows unavailable |
| 10 | Log the outbound AI prompt | Contains no name, address, age, sex, nationality, or ID number |
| 11 | Approve 9001 | Acknowledgement modal appears, note is required, approval succeeds |
| 12 | Approve 9002 | No modal |
| 13 | Compare claimant emails for 9001 and 9002 approvals | Identical, no fraud wording |
| 14 | Search the codebase for 'is fraud', 'fraudulent claim', 'fake' | No hits in UI copy or prompts |

Tests 4, 6, 9, and 10 are the four worth demonstrating live. Each one answers an
obvious panel question with a behaviour rather than a promise.

---

## What to say in the paper

**Frame the module as an advisory, and defend that as the finding, not the fallback.**
The strongest sentence you can write is that the design follows from the data: claim
frequency is a well-established investigation trigger and is equally well established
as not being evidence of fraud, therefore a frequency-driven module can only warn.
Building it as a blocking detector would have been the easier implementation and the
wrong one.

**Name the agentic boundary explicitly.** The AI performs tool-grounded reasoning over
facts retrieved from the claims database and produces a structured explanation with
suggested next actions. It does not determine the outcome, cannot introduce an
indicator, and receives no identifying information about the claimant. Say why: an LLM
that can flip a claim's state on a hallucination can accuse a real person.

**Report your false-positive control as a designed mechanism.** The dispersion
suppression on FR-02a and the observation-versus-indicator split are the two things
stopping this from behaving like a rules-only system, which the literature puts at 60
to 85 percent false positive rates. Pedro Ramirez is your worked example.

**State the limitations honestly.** Single-carrier history only, so a claimant filing
with several insurers is invisible without an industry database such as MCIS. Vision
severity is model-produced and drives FR-03a. Identity resolution is exact-match only
by design. Thresholds are set by judgement, not calibrated against labelled outcomes,
and the acknowledgement log built in Step 7 is the mechanism by which real labelled
data would be accumulated.

**Future work, in priority order:** MCIS or industry-registry lookup; network analysis
across shared repair shops, payees, and witnesses; image forensics (EXIF, perceptual
hash duplicates, AI-generated image detection); and threshold calibration once
acknowledgement data exists.
