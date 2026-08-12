# InsureCopilot: FR-01 Fraud Check
## Claude Code Implementation Plan

Repo: `stsp001_capstone_insurance_helper`
Primary file: `screen_V2.html` (single-file React via Babel standalone)
Target: one deterministic fraud check, wired end to end, demoable across all four mock claims.

---

## How to use this file

1. Put Section 1 into a `CLAUDE.md` at the repo root. Claude Code reads it automatically on every session.
2. Work through Steps 1 to 7 in order. Each step has a prompt block you paste directly.
3. Do not skip Step 0. It prevents the two most likely ways this goes wrong.
4. After each step, check the acceptance criteria before moving on. Ask Claude Code to fix failures before continuing.

Run one step per conversation turn. Do not paste all seven at once. Claude Code does better work on a bounded task, and you can catch drift early.

---

## Section 1: Contents for `CLAUDE.md`

Create this file at the repo root. Copy everything between the fences.

```markdown
# InsureCopilot: Project Context for Claude Code

## What this is
A capstone prototype. A web-based assistant for Philippine motor-claims adjusters.
It consolidates claim documents, shows AI-extracted field values, runs rule-based
policy evaluation, and lets the adjuster correct extracted data and re-run analysis
before making a final decision. Human-in-the-loop (HITL) is the core design principle.

## Current state
- `screen_V2.html` is the live prototype. Single file. React 18 via UMD + Babel
  standalone + Tailwind via CDN. All state is client-side `useState`. No build step.
- `screen.html` is an older version. Do not edit it.
- `policy_loader.py` extracts policy rules from a PDF into JSON via Gemini and writes
  to MongoDB. NOTE: it imports `mongo_rules_store`, which does not exist in this repo.
  It will not run until that module is added.
- `claude_ocr.py` and `gemini_ocr.py` are scratch OCR spikes, not wired to the UI.
- There is no backend service yet. AI evaluation is simulated in the frontend.

## Architecture principle
AI, OCR, rules engine, and fraud detection must be pluggable services. Any new module
goes in as a pure function with a defined input and output shape so it can later move
to a backend endpoint without touching UI code.

## Non-negotiable guardrails for the fraud module

1. A fraud signal NEVER changes the payout. Only policy rules adjust `approvedPayout`.
   Fraud output only changes routing and UI state.
2. Fraud output is stored in a separate `fraudAssessment` object. Never merge fraud
   hits into the existing `rules` array. The two are different kinds of claim and must
   look different on screen.
3. The system never uses the words "fraud", "fraudulent", "fake", or "lying" in any
   text shown to a claimant. Internal adjuster-facing UI may say "Integrity Review"
   and "Refer to SIU". Claimant-facing text says "additional verification required".
4. Every fraud hit must carry evidence: the field or document that triggered it, and
   the values that conflict. A hit with no evidence does not fire.
5. The adjuster can dismiss any hit, and every dismissal is logged with a reason.
6. No demographic or proxy inputs in scoring. No address, barangay, income, age,
   occupation, or name-based signals.

## Code conventions
- Match the existing Tailwind utility style in `screen_V2.html`. No new CSS files.
- No new npm dependencies. No build tooling. Keep the single-file structure.
- Keep new pure logic ABOVE the `function App()` declaration, alongside
  `initialClaimsDatabase` and `claimRequirements`.
- Currency renders as `₱{value.toLocaleString()}`.
- Dates in data are ISO strings: `'2026-01-28'`.

## Definition of done for any change
The file still opens directly in a browser with no server and no console errors.
```

---

## Step 0: Baseline and hygiene

**Why:** the KPI counts are hardcoded, so the moment you add a fraud tab the dashboard
will lie. Fix that first, on its own commit, so a later bug is obviously yours and not
inherited.

**Prompt:**

```
Read screen_V2.html and give me a short map of the file: where the mock database
ends, where App() starts, where the dashboard renders, and where the right-hand
assessment panel renders. Give me line numbers.

Then make one change only: the three dashboard KPI cards currently have hardcoded
counts ("4 Claims", "3 Claims", "1 Claim"). Replace them with values computed from
claimsDb using the same filter logic that drives the tabs (All Open, Flagged /
Exceptions, Clean / Straight-Through). Handle singular vs plural ("1 Claim" vs
"2 Claims").

Do not add any fraud logic yet. Do not touch anything else.
```

**Acceptance criteria**
- Counts update automatically if you add or remove a claim from `initialClaimsDatabase`.
- No console errors, page still renders.

---

## Step 1: Add the date fields

**Why:** there are currently no dates anywhere in the data model. FR-01 is entirely
about dates, so this is the prerequisite.

**Prompt:**

```
Add date fields to every claim in initialClaimsDatabase in screen_V2.html.

Add these four top-level fields to each of the four claims:
  policyInceptionDate  (ISO string)
  policyExpiryDate     (ISO string)
  incidentDate         (ISO string, the date the loss occurred)
  reportedDate         (ISO string, the date the claim was filed)

Use these exact values, they are chosen to drive a specific demo:

CLM-2026-8891 (Juan Dela Cruz)
  policyInceptionDate: '2026-01-15'
  policyExpiryDate:    '2027-01-14'
  incidentDate:        '2025-01-28'   // deliberately wrong, see below
  reportedDate:        '2026-02-02'

CLM-2026-8892 (Reign Batac)
  policyInceptionDate: '2026-01-20'
  policyExpiryDate:    '2027-01-19'
  incidentDate:        '2026-02-10'
  reportedDate:        '2026-02-12'

CLM-2026-8893 (Roberto Tan)
  policyInceptionDate: '2025-08-01'
  policyExpiryDate:    '2026-07-31'
  incidentDate:        '2026-03-04'
  reportedDate:        '2026-03-06'

CLM-2026-8894 (Maria Santos)
  policyInceptionDate: '2025-06-10'
  policyExpiryDate:    '2026-06-09'
  incidentDate:        '2026-02-01'
  reportedDate:        '2026-02-20'

Then add OCR entries so these dates are HITL-editable, matching the existing
ocrData object shape exactly.

For CLM-2026-8891, add an ocrData entry:
  fieldId: 'incident_date'
  label: 'Extracted Incident Date (Claim Form)'
  extractedValue: '2025-01-28'
  correctedValue: null
  confidence: 'Low (58%)'
  isLowConfidence: true
  sourceDoc: 'doc-1'
  issueNote: 'Handwritten year digit is smudged on the scanned form. Reads as 2025.'

For CLM-2026-8892, add an ocrData entry:
  fieldId: 'incident_date'
  label: 'Extracted Incident Date (Claim Form)'
  extractedValue: '2026-02-10'
  correctedValue: null
  confidence: 'High (97%)'
  isLowConfidence: false
  sourceDoc: 'doc-1'
  issueNote: 'Clearly printed on the claim form.'

Also add to CLM-2026-8892 a new field on the doc-1 document object:
  documentStatedIncidentDate: '2026-01-05'
with a comment noting this represents the date on the attached police report,
which disagrees with the claim form.

Add matching incident_date ocrData entries for 8893 and 8894 with high confidence
and values matching their incidentDate above.

Do not write any fraud logic yet.
```

**Acceptance criteria**
- All four claims have the four date fields.
- All four have an `incident_date` entry in `ocrData`.
- 8891's entry is flagged low confidence.
- The existing OCR correction modal can already open and edit the new field with no
  extra work. Test this manually.

---

## Step 2: Build the fraud engine as a pure function

**Why:** this is the pluggable service. Keep it completely free of React so it can be
lifted into a Python backend later with a direct translation.

**Prompt:**

```
In screen_V2.html, directly above `function App()`, add a self-contained fraud
detection engine. It must be pure JavaScript with no React and no side effects.

Structure it as three parts.

PART A: the rule catalogue.
const FRAUD_RULES = [ ... ] where each rule is:
{
  code: 'FR-01a',
  label: 'Incident Predates Policy Inception',
  category: 'Temporal Inconsistency',
  severity: 'hard',            // 'hard' | 'soft'
  weight: 55,
  evaluate: (ctx) => null | { evidence: {...}, detail: 'string' }
}

The five rules:

FR-01a  Incident Predates Policy Inception          hard  weight 55
  Fires when incidentDate < policyInceptionDate.
  evidence: { fieldId: 'incident_date', sourceDoc: 'doc-1',
              claimed: incidentDate, comparedTo: policyInceptionDate }
  detail: 'Incident date {incidentDate} falls {N} days before policy inception
           on {policyInceptionDate}. Damage may predate coverage.'

FR-01b  Incident After Policy Expiry                hard  weight 55
  Fires when incidentDate > policyExpiryDate. Same evidence shape.

FR-01c  Cross-Document Date Conflict                hard  weight 40
  Fires when any document has documentStatedIncidentDate and it differs from the
  claim form incidentDate.
  evidence: { fieldId: 'incident_date', sourceDoc: <that doc's id>,
              claimed: incidentDate, comparedTo: documentStatedIncidentDate }
  detail: 'Claim form states {incidentDate}. Attached document "{doc.title}"
           states {documentStatedIncidentDate}. Discrepancy of {N} days.'

FR-01d  Policy Freshness                            soft  weight 15
  Fires when 0 <= (incidentDate - policyInceptionDate) <= 30 days.
  detail: 'Incident occurred {N} days after policy inception.'

FR-01e  Delayed Reporting                           soft  weight 10
  Fires when (reportedDate - incidentDate) > 14 days.
  detail: 'Claim reported {N} days after the incident date.'

PART B: suppression.
const SUPPRESSION_RULES = [ ... ] where each is:
{ appliesTo: 'FR-01e', reason: 'string', test: (ctx) => boolean }

Add one suppression rule: FR-01e is suppressed when the claim's cause of loss or
claim type indicates a natural peril event. Detect this by checking whether any
ocrData entry with fieldId 'cause_of_loss' has a value matching /typhoon|flood|
storm|water ingress|submersion/i, OR the claim's rules array contains text matching
/acts of nature|AON/i.
reason: 'Delayed reporting is expected during a declared natural peril event.'

PART C: the runner.
function runFraudCheck(claim) that:
  - builds ctx from the claim, using correctedValue ?? extractedValue for any
    ocrData-backed field so that HITL corrections are respected
  - evaluates every rule
  - applies suppression, moving suppressed hits into a separate array
  - sums weight for non-suppressed hits, caps at 100
  - applies the SOFT-ONLY FLOOR: if every non-suppressed hit has severity 'soft',
    the band is forced to 'CLEAR' regardless of score. No soft signal alone can
    escalate a claim.
  - returns:
    {
      score: number,
      band: 'CLEAR' | 'VERIFY' | 'REFER',
      hits: [ { code, label, category, severity, weight, detail, evidence } ],
      suppressed: [ { code, label, detail, suppressionReason } ],
      evaluatedAt: ISO string,
      engineVersion: 'fraud-engine-0.1.0'
    }

Bands: score 0-24 CLEAR, 25-54 VERIFY, 55-100 REFER, subject to the soft-only floor.

Write a small helper daysBetween(isoA, isoB) rather than pulling in a date library.

Add a comment block above the engine documenting the input contract so this can be
ported to a Python service later.

Do not wire this into the UI yet. Do not modify App().
```

**Acceptance criteria**

Open the browser console and verify manually:

```js
runFraudCheck(initialClaimsDatabase['CLM-2026-8891'])
// FR-01a + FR-01e expected. band REFER.

runFraudCheck(initialClaimsDatabase['CLM-2026-8892'])
// FR-01c + FR-01d expected. band REFER.

runFraudCheck(initialClaimsDatabase['CLM-2026-8893'])
// no hits. band CLEAR. score 0.

runFraudCheck(initialClaimsDatabase['CLM-2026-8894'])
// FR-01e fires then suppressed. band CLEAR. suppressed array length 1.
```

If 8894 comes back VERIFY or REFER, the suppression or the soft-only floor is wrong.
Fix it before Step 3.

---

## Step 3: Wire into state and the re-run pipeline

**Prompt:**

```
Wire runFraudCheck into App() in screen_V2.html.

1. Add state: const [fraudResults, setFraudResults] = useState({}) keyed by claim id.

2. On initial mount, compute runFraudCheck for every claim in claimsDb and populate
   fraudResults. Use useEffect with an empty dependency array.

3. Extend runAiAnalysis(reason) so that after the simulated delay it also re-runs
   runFraudCheck for the currently selected claim against the CURRENT claimsDb state
   (so OCR corrections are picked up) and updates fraudResults for that claim.

4. In handleSaveOcrCorrection, after the ocrData update is applied, re-run the fraud
   check for that claim and update fraudResults. Push an entry into activityLogs
   describing the band change if the band changed, for example:
   'Integrity band changed REFER to CLEAR on CLM-2026-8891 after field correction.'

5. IMPORTANT: do not let any of this touch approvedPayout, recommendedPayout, or the
   rules array. Verify by reading your own diff before finishing.

Add a derived helper inside App():
   const activeFraud = fraudResults[selectedClaimId] || null;
```

**Acceptance criteria**
- Correcting 8891's `incident_date` to `2026-01-28` and saving flips its band from
  REFER to CLEAR, and the payout figure does not change.
- Correcting 8892's `incident_date` does not clear its band, because FR-01c compares
  against the document, not the form field alone.

---

## Step 4: Dashboard UI

**Prompt:**

```
Add fraud surfacing to the dashboard in screen_V2.html.

1. Add a fourth KPI card to the existing grid. Change the grid from grid-cols-3 to
   grid-cols-4. New card:
     label: 'Integrity Review'
     value: count of claims with band VERIFY or REFER
     sublabel: 'Requires verification or SIU referral'
   Style it distinctly from the existing three. Use a violet/purple palette
   (violet-600 / violet-50 / violet-200) so it is visually separate from the
   green/amber/red used by the policy rules engine. This separation is deliberate
   and must be maintained: policy colours mean coverage, violet means integrity.

2. Add a fifth tab: 'Integrity Review'. Its filter shows claims where status is
   'In Assessment' and band is VERIFY or REFER.

3. Add an 'Integrity' column to the claims table, between 'Flags & Summary' and
   'Docs'. Render a compact chip:
     CLEAR  -> slate chip, text 'CLEAR'
     VERIFY -> amber chip, text '{score} VERIFY'
     REFER  -> violet chip, text '{score} REFER'
   Keep it small, matching the existing text-xs styling.

Do not change the payout or flag columns.
```

**Acceptance criteria**
- Integrity Review card reads 2 on first load (8891 and 8892).
- The Integrity Review tab lists exactly those two.
- After correcting 8891, both the card and the tab update to 1.

---

## Step 5: The integrity card in the claim workspace

This is the centrepiece. Give it its own step.

**Prompt:**

```
In screen_V2.html, add a Claim Integrity Assessment card to the right-hand panel of
the detail screen. Place it directly BELOW the existing 'Automated Policy Rules &
Flags' card and ABOVE the 'Master Policy Contract Citation' block.

Visual requirements:
- Violet-themed card, clearly distinct from the policy rules card. Do NOT reuse the
  🟢🟡🔴 emoji indicators used by the policy rules, because adjusters must never
  confuse 'not covered' with 'needs verification'.
- Header row: title 'Claim Integrity Assessment' on the left, a score badge on the
  right showing the numeric score and the band label.
- Beneath the header, a one-line explanation of what the band means:
    CLEAR:  'No integrity signals. Normal processing.'
    VERIFY: 'Verification required before approval.'
    REFER:  'Payout locked. Refer to Special Investigation Unit.'

For each hit, render a row containing:
- the rule code and label
- the weight, right-aligned and de-emphasised
- the detail sentence
- a 'View evidence' button

The 'View evidence' button must do two things when clicked:
  a) call scrollToDoc(hit.evidence.sourceDoc) to jump the left document viewer
  b) call setActiveOcrFieldId(hit.evidence.fieldId) so the HITL field panel selects
     the field that triggered the hit
This reuses the existing functions. Do not write new navigation logic.

For each suppressed entry, render a visually muted row with a ⊘ marker, the label,
the text 'SUPPRESSED', and the suppression reason. Suppressed rows must be visible,
not hidden. Showing what the system chose NOT to flag is a feature.

If there are no hits and no suppressed entries, render a compact single-line green
state: 'No integrity signals detected.'

Add a small footer line to the card in monospace text-[10px]:
  'Engine {engineVersion} · evaluated {evaluatedAt}'
```

**Acceptance criteria**
- On 8891, clicking "View evidence" on FR-01a scrolls to doc-1 and selects the
  `incident_date` field in the HITL panel.
- On 8894, the suppressed FR-01e row is visible with its reason.
- On 8893, the empty state renders.

---

## Step 6: Action gating, dismissal, and audit trail

**Why:** this is what turns a flag into a workflow. It is also what generates the
labelled data you will cite in your future-work section.

**Prompt:**

```
Add decision gating and an audit trail to screen_V2.html.

1. ACTION GATING in the Final Decision Payout card:
   - When band is 'REFER': disable the '⚡ Approve' button (greyed, not clickable)
     and add a new violet button 'Refer to SIU' in its place. 'Deny Claim' stays
     available. Add a small line under the buttons: 'Approval locked pending
     integrity review.'
   - When band is 'VERIFY': keep Approve enabled, but if any hit has not been
     dismissed or confirmed, intercept the click and show a small inline warning:
     'Dispose of all open integrity signals before approving.'
   - When band is 'CLEAR': no change to current behaviour.

2. HIT DISPOSITION:
   Add two small buttons to each hit row in the integrity card: 'Confirm' and
   'Dismiss'. Both open a small prompt for a required free-text reason (reuse the
   existing modal pattern used by Edit Payout / Deny Claim rather than window.prompt).
   Store dispositions in new state:
     const [dispositions, setDispositions] = useState({})
   keyed by `${claimId}::${hitCode}`, storing
     { action: 'confirm' | 'dismiss', reason, adjuster: 'Ethan Jackson', at: ISO }
   Render disposed hits with a struck-through or muted style plus a badge showing
   the action and the reason.

   A dismissal does NOT change the score. It marks the hit as handled. Recomputing
   the score from adjuster opinion would defeat the audit trail. Add a code comment
   saying exactly this so a future contributor does not "fix" it.

3. ACTIVITY LOG:
   Push an entry into activityLogs for every disposition and every SIU referral.

4. SIU REFERRAL:
   'Refer to SIU' sets the claim status to 'Referred to SIU' and opens a modal
   titled 'SIU Referral Packet' showing a read-only summary:
     - claim id, policyholder, vehicle, claimed amount
     - incident date, reported date, policy inception, policy expiry
     - every hit with code, label, weight, detail, and evidence values
     - every suppressed entry with its reason
     - the adjuster's dispositions
     - engine version and evaluation timestamp
   Give the modal a 'Copy to clipboard' button that copies this as plain text.
   Add 'Referred to SIU' handling wherever status is currently checked, including
   the status badge in the header and the Completed tab filter.

5. CLAIMANT NOTIFICATION LOCK:
   In the policyholder email modal, if band is 'REFER' or status is 'Referred to
   SIU', replace the decision email body with a neutral verification notice. It must
   not mention fraud, suspicion, or investigation. Use wording along the lines of:
   'We are currently completing additional verification on your claim and may
   request further documentation. We will update you once this is complete.'
   Also ensure the free-text adjuster note is NOT included in this variant.
```

**Acceptance criteria**
- 8892 cannot be approved. The Approve button is disabled and Refer to SIU appears.
- Dismissing a hit on 8891 leaves the score unchanged but marks the row handled.
- The referral packet modal opens and copies clean text.
- The claimant email for a REFER claim contains no fraud language and no adjuster note.

---

## Step 7 (optional): Mirror the engine in Python

Only do this if you are moving to a real backend before the defense. It is a clean
port because Step 2 kept the engine pure.

**Prompt:**

```
Create fraud_engine.py at the repo root. Port the FR-01 rule catalogue, suppression
rules, and runFraudCheck from screen_V2.html to Python, preserving rule codes,
weights, bands, the soft-only floor, and the output shape exactly.

Expose:
  def run_fraud_check(claim: dict) -> dict

Use only the standard library (datetime). No new dependencies in requirements.txt.

Add a __main__ block that runs the four demo claims from a small inline fixture and
prints code, band, and score for each, so the port can be verified against the
JavaScript results.

Do not import or modify policy_loader.py. Note in a docstring that policy_loader.py
currently imports a missing module named mongo_rules_store.
```

---

## Verification script before your defense

Run this checklist manually and record the result. It is your evaluation section.

| # | Test | Expected |
|---|---|---|
| 1 | Load dashboard | Integrity Review card reads 2 |
| 2 | Open 8893 | 'No integrity signals detected' |
| 3 | Open 8894 | FR-01e visible as SUPPRESSED with reason, band CLEAR |
| 4 | Open 8891 | FR-01a + FR-01e, band REFER, Approve disabled |
| 5 | On 8891 click 'View evidence' | Left pane jumps to doc-1, HITL selects incident_date |
| 6 | Correct 8891 incident_date to 2026-01-28, save | Band flips to CLEAR, Approve re-enables |
| 7 | Confirm payout on 8891 before and after step 6 | Identical. Fraud never moved the number |
| 8 | Open 8892 | FR-01c + FR-01d, band REFER |
| 9 | Correct 8892 incident_date to 2026-01-05 | FR-01c clears but FR-01a fires (now pre-inception). Still REFER. Document why in your paper: correcting toward the document does not launder the claim |
| 10 | Refer 8892 to SIU | Packet modal renders complete, copy works |
| 11 | Open claimant email on 8892 | Neutral verification wording, no fraud language, no adjuster note |
| 12 | Dismiss a hit on 8892 with a reason | Score unchanged, row marked handled, activity log entry created |

Test 9 is worth calling out explicitly in your defense. It shows the check is not
trivially defeatable by editing one field, which is the obvious attack on a
deterministic rule.

---

## What to say in the paper about scope

State plainly that FR-01 is one rule family from a designed catalogue, implemented as
a vertical slice to prove the architecture. Then list what the pluggable interface
admits next, in priority order:

- **FR-02 Estimate Integrity.** Line item sum versus claimed amount, duplicated line
  items, parts billed with no corresponding damage evidence. Buildable now with the
  existing `documents[].items` array, needs no new data.
- **FR-03 Identity Consistency.** Plate, chassis, and engine number agreement across
  the claim form, registration, and photos.
- **FR-04 Image Forensics.** EXIF timestamp and GPS extraction, perceptual hash
  duplicate detection across prior claims, AI-generated image detection. EXIF is the
  cheapest real win here (Python Pillow, no external service).
- **FR-05 External Registry.** MCIS lookup through PIRA for vehicles previously
  declared total loss, stolen, or carnapped. Mock the interface, specify the
  integration path.
- **FR-06 Network Analysis.** Shared repair shop, phone, payee, or witness across
  unrelated claims. This is what commercial platforms actually sell, and it is the
  only way to catch rings rather than individuals.

Also state the evaluation limitation honestly: with no access to a carrier's labelled
claims data, the system is validated against a designed synthetic corpus, and the
disposition log built in Step 6 is the mechanism by which a real labelled dataset
would be accumulated in production.
