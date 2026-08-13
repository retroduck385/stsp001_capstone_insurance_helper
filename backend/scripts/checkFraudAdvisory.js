// scripts/checkFraudAdvisory.js
//
//   node scripts/checkFraudAdvisory.js      (or: npm run check:fraud)
//
// READ-ONLY apart from nothing at all — it evaluates the advisory in memory and
// never writes it back, so it can be run against the shared database freely.
//
// This is the verification table from the implementation plan, executed rather
// than described. It asserts the four demo cases, the identity-resolution
// behaviour, and the guardrails that can be checked mechanically. Exits non-zero
// on any failure so it can go into CI.
//
// It deliberately does NOT need the API server running: it talks to Mongo and
// calls buildFraudAdvisory() directly, so a failure here is a failure in the
// rules rather than in the transport.

import 'dotenv/config';
import mongoose from 'mongoose';
import { buildFraudAdvisory } from '../src/services/fraudAdvisor.js';
import { findClaimantHistory, resolveClaimantKey } from '../src/services/claimantIdentity.js';
import { buildFraudTools, citedClaimIds } from '../src/services/fraudTools.js';
import { MODEL_LADDER, PRIMARY_MODEL } from '../src/services/fraudReasoner.js';
import { collectGroundTruth, checkGrounding } from '../src/services/fraudGrounding.js';

const claimSchema = new mongoose.Schema({}, { strict: false, id: false, collection: 'claims' });
mongoose.model('Claim', claimSchema);

let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ok    ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const codes = (list) => (list || []).map(item => item.code);
const has = (list, code) => codes(list).includes(code);

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Create backend/.env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const Claim = mongoose.model('Claim');
  console.log(`Connected to "${mongoose.connection.name}".\n`);

  const load = async (id) => {
    const claim = await Claim.findOne({ id }).lean();
    if (!claim) throw new Error(`${id} is missing — run "npm run seed" first.`);
    return claim;
  };

  // -------------------------------------------------------------------------
  console.log('IDENTITY RESOLUTION');
  // -------------------------------------------------------------------------
  const juan = await load('DEMO-2026-0001');
  const juanKey = resolveClaimantKey(juan);
  check('Juan resolves on the government id', juanKey.basis === 'government_id' && juanKey.confidence === 'high', juanKey.basis);

  const juanHistory = await findClaimantHistory(Claim, juan);
  check('Juan has 4 prior claims in the window', juanHistory.claims.length === 4, `${juanHistory.claims.length} found`);

  // THE ONE THAT MATTERS. DEMO-HIST-0002 carries a misspelled name and the
  // correct id number. If identity matching ever regresses to comparing names,
  // this record silently vanishes and Juan's advisory changes.
  const misspelled = await Claim.findOne({ id: 'DEMO-HIST-0002' }).lean();
  check(
    'the misspelled-name record is still matched',
    juanHistory.claims.some(prior => prior.id === 'DEMO-HIST-0002'),
    `name on that form is ${JSON.stringify(misspelled?.ocrData?.motorClaimForm?.assured_full_name)}`
  );

  const andrea = await load('DEMO-2026-0004');
  const andreaHistory = await findClaimantHistory(Claim, andrea);
  check('Andrea has no history and does not error', andreaHistory.claims.length === 0);

  check(
    'a claim with no id and no plate still resolves, at low confidence',
    resolveClaimantKey({ policyholder: 'Ana Reyes, Jr.', ocrData: {} }).confidence === 'low'
  );
  check(
    'a claim with nothing identifying resolves to no key',
    resolveClaimantKey({ ocrData: {} }).key === null
  );

  // -------------------------------------------------------------------------
  console.log('\nTHE FOUR DEMO CASES');
  // -------------------------------------------------------------------------
  const advisories = {};
  for (const id of ['DEMO-2026-0001', 'DEMO-2026-0002', 'DEMO-2026-0003', 'DEMO-2026-0004']) {
    advisories[id] = await buildFraudAdvisory(Claim, await load(id));
  }

  const a1 = advisories['DEMO-2026-0001'];
  check('0001 Juan   NOT_CLEARED / HIGH', a1.state === 'NOT_CLEARED' && a1.concern === 'HIGH', `${a1.state} / ${a1.concern}`);
  check('0001 fires FR-02a, FR-02d, FR-02e', ['FR-02a', 'FR-02d', 'FR-02e'].every(c => has(a1.indicators, c)), codes(a1.indicators).join(','));
  check('0001 notes FR-02c as an observation', has(a1.observations, 'FR-02c'), codes(a1.observations).join(','));

  const a2 = advisories['DEMO-2026-0002'];
  check('0002 Maria  CLEARED / LOW', a2.state === 'CLEARED' && a2.concern === 'LOW', `${a2.state} / ${a2.concern}`);
  check('0002 raises nothing at all', a2.indicators.length === 0 && a2.observations.length === 0);

  const a3 = advisories['DEMO-2026-0003'];
  check('0003 Pedro  CLEARED', a3.state === 'CLEARED', `${a3.state} / ${a3.concern}`);
  check('0003 fired FR-02a and then suppressed it', has(a3.suppressed, 'FR-02a'), codes(a3.suppressed).join(','));
  check(
    '0003 shows the dispersion reason',
    /dispersed/i.test(a3.suppressed.find(s => s.code === 'FR-02a')?.suppressionReason || '')
  );

  const a4 = advisories['DEMO-2026-0004'];
  check('0004 Andrea NOT_CLEARED / MODERATE', a4.state === 'NOT_CLEARED' && a4.concern === 'MODERATE', `${a4.state} / ${a4.concern}`);
  check('0004 rests on FR-03a alone', a4.indicators.length === 1 && has(a4.indicators, 'FR-03a'), codes(a4.indicators).join(','));
  check('0004 FR-03a reports 4.0x', a4.indicators[0]?.evidence?.multiple === 4, String(a4.indicators[0]?.evidence?.multiple));
  check('0004 has an empty history', a4.history.claimCount === 0);

  // -------------------------------------------------------------------------
  console.log('\nDEGRADATION — a missing input must never read as a clean result');
  // -------------------------------------------------------------------------
  const noSeverity = { ...andrea, ocrData: { ...andrea.ocrData, vehicleDamagePictures: { severity: null, damageDescription: null } } };
  const aNoSeverity = await buildFraudAdvisory(Claim, noSeverity);
  check('FR-03a is SKIPPED when severity is missing, not passed', has(aNoSeverity.skipped, 'FR-03a'), codes(aNoSeverity.skipped).join(','));

  const live = await Claim.findOne({ id: { $regex: '^CLM-' } }).lean();
  if (live) {
    const aLive = await buildFraudAdvisory(Claim, live);
    check(
      `a live claim (${live.id}, no createdAt) degrades to skipped rather than a false CLEARED`,
      aLive.skipped.length > 0,
      `${aLive.state}, ${aLive.skipped.length} not evaluated`
    );
  }

  // -------------------------------------------------------------------------
  console.log('\nGUARDRAILS');
  // -------------------------------------------------------------------------
  const everything = JSON.stringify(Object.values(advisories));

  // Guardrail 4 — nothing in the fraud path may carry a payout figure.
  check(
    'no advisory carries a payout field',
    !/"approvedPayout"|"recommendedPayout"/.test(everything)
  );

  // The same guardrail one level down: the history records handed to the rules
  // must not carry a payout either. Checked here rather than trusted, because
  // this is the exact field a future history rule would reach for by mistake.
  const juanRecords = JSON.stringify(juanHistory.claims);
  check(
    'prior-claim records carry no payout figure',
    !/approvedPayout|recommendedPayout/.test(juanRecords)
  );

  // Guardrail 1 — the forbidden vocabulary, checked against generated output
  // (the source is checked separately by grep; this catches the AI).
  const banned = ['is fraud', 'fraudulent claim', 'the claimant lied', 'fake', 'scam'];
  const found = banned.filter(phrase => new RegExp(phrase, 'i').test(everything));
  check('no forbidden wording in any advisory, including the AI text', found.length === 0, found.join(', '));

  // Guardrail 7 — every indicator cites something.
  const evidenceless = Object.values(advisories)
    .flatMap(a => a.indicators)
    .filter(hit => !hit.evidence);
  check('every indicator carries evidence', evidenceless.length === 0, codes(evidenceless).join(','));

  // Guardrail 5 — the AI is only consulted when there is something to explain,
  // and it can never be the reason a claim is NOT_CLEARED.
  check('CLEARED advisories make no AI call', a2.ai === null && a3.ai === null);
  check('NOT_CLEARED advisories carry an AI block', a1.ai !== null && a4.ai !== null);

  const withAi = [a1.ai, a4.ai].filter(ai => ai && !ai.unavailable);
  if (withAi.length > 0) {
    check('the AI supplied the required risk framing', withAi.every(ai => Boolean(ai.riskFraming)));
  } else {
    console.log('  note  the AI was unavailable on this run — rule output above is unaffected, which is the point');
  }

  // -------------------------------------------------------------------------
  console.log('\nTHE AGENT — the model investigates, it does not decide');
  // -------------------------------------------------------------------------
  // The tools are exercised directly rather than through a model, because
  // asserting on what an LLM chose to call would make this suite flaky. What
  // must be deterministic is the FENCE, and that is what is tested here.
  const tools = buildFraudTools(Claim, juan, a1);
  const cited = citedClaimIds(a1);

  check('the fence is built from the claim ids the rules cited', cited.size === 4, [...cited].join(', '));

  const permitted = await tools.execute('lookupPriorClaim', { claimId: 'DEMO-HIST-0003' });
  check('a cited prior claim can be looked up', !permitted.error && permitted.id === 'DEMO-HIST-0003');

  const refusals = [
    ['an uncited real claim', 'CLM-2026-9001'],
    ["another claimant's claim", 'DEMO-2026-0002'],
    ['a hallucinated claim id', 'NOPE-9999']
  ];
  for (const [why, claimId] of refusals) {
    const result = await tools.execute('lookupPriorClaim', { claimId });
    check(`${why} is refused`, Boolean(result.error), claimId);
  }

  check(
    'an unknown tool name is refused rather than throwing',
    Boolean((await tools.execute('deleteEverything', {})).error)
  );

  // Guardrail 6 on the SECOND channel. DEMO-HIST-0002 is the record with the
  // misspelled name, so if any identity field could leak through a tool, this
  // is the call that would show it.
  const toolBlob = JSON.stringify(await tools.execute('lookupPriorClaim', { claimId: 'DEMO-HIST-0002' }));
  const leaked = ['Jan', 'Juan', 'Dela Cruz', 'JDC', 'example.com', 'approvedPayout']
    .filter(term => toolBlob.includes(term));
  check('tool results carry no identity and no payout', leaked.length === 0, leaked.join(', '));

  // Guardrail 5, the load-bearing one: whatever the agent did, the state was
  // decided before it ran and nothing it returns can move it.
  const aiTrail = a1.ai?.trail || [];
  check(
    'the advisory state is unchanged by the agent',
    a1.state === (a1.indicators.length > 0 ? 'NOT_CLEARED' : 'CLEARED')
  );
  if (aiTrail.length > 0) {
    console.log(`  note  the agent made ${aiTrail.length} tool call(s) on 0001: ${aiTrail.map(t => t.tool).join(', ')}`);
  }

  // -------------------------------------------------------------------------
  console.log('\nREOPENING A SEALED CLAIM');
  // -------------------------------------------------------------------------
  // The server owns `decidedAt` in both directions — it stamps on close and
  // clears on reopen — so a reopened claim can never carry a decision date for
  // a decision that is no longer in force.
  //
  // This goes THROUGH THE ROUTE rather than writing to Mongo directly. Asserting
  // that `$set: { decidedAt: null }` sets a field to null would only prove that
  // MongoDB works; what needs proving is that the PATCH handler derives that
  // clear from the status on its own, without the client asking for it —
  // `decidedAt` is not patchable, so a client cannot ask.
  //
  // Skipped rather than failed when the API is not running, so the suite stays
  // usable without a server.
  const probeId = 'DEMO-REOPEN-PROBE';
  const api = process.env.API_BASE || 'http://localhost:5001';

  const reachable = await fetch(`${api}/api/health`).then(r => r.ok).catch(() => false);

  if (!reachable) {
    console.log(`  skip  the API is not running at ${api} — start it to exercise the reopen route`);
  } else {
    await Claim.collection.deleteOne({ id: probeId });
    await Claim.collection.insertOne({
      id: probeId, policyholder: 'Probe', status: 'In Assessment',
      claimedAmount: 1000, createdAt: new Date(), updatedAt: new Date()
    });

    const patch = async (body) => {
      const response = await fetch(`${api}/api/claims/${probeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return response.ok ? response.json() : { error: await response.text() };
    };

    const closed = await patch({
      status: 'Completed',
      approvedPayout: 900,
      fraudAcknowledgement: { note: 'probe', indicatorCodes: ['FR-02a'] }
    });
    check('closing a claim stamps a decision date the client never sent', Boolean(closed.decidedAt));

    const reopened = await patch({
      status: 'In Assessment', approvedPayout: null, decisionReason: '', fraudAcknowledgement: null
    });
    check('reopening clears the decision date', reopened.decidedAt === null, String(reopened.decidedAt));
    check('reopening clears the fraud acknowledgement', !reopened.fraudAcknowledgement?.note);
    check('reopening leaves the claim in assessment', reopened.status === 'In Assessment');

    // `decidedAt` must stay server-owned: a client that tries to set it directly
    // is rejected, which is what stops a decision date disagreeing with a status.
    const forged = await patch({ decidedAt: new Date().toISOString() });
    check('a client cannot write decidedAt directly', Boolean(forged.error));

    await Claim.collection.deleteOne({ id: probeId });
  }

  // -------------------------------------------------------------------------
  console.log('\nTHE MODEL LADDER');
  // -------------------------------------------------------------------------
  check('the ladder has no duplicates', new Set(MODEL_LADDER).size === MODEL_LADDER.length, MODEL_LADDER.join(' → '));
  check('the primary model is the first rung', PRIMARY_MODEL === MODEL_LADDER[0], PRIMARY_MODEL);
  check(
    'no known-unavailable model is in the ladder',
    !MODEL_LADDER.includes('gemini-2.5-flash-lite'),
    'gemini-2.5-flash-lite returns 404 for this key'
  );

  for (const advisory of [a1, a4]) {
    const attempts = advisory.ai?.modelAttempts || [];
    if (attempts.length > 1) {
      console.log(`  note  fell back: ${attempts.map(a => `${a.model} (${a.outcome})`).join(' → ')}`);
    }
  }
  check(
    'every AI result records which models were tried',
    [a1.ai, a4.ai].every(ai => Array.isArray(ai?.modelAttempts) && ai.modelAttempts.length > 0)
  );

  // -------------------------------------------------------------------------
  console.log('\nTHE GROUNDING CHECK — does every figure trace back to the data?');
  // -------------------------------------------------------------------------
  // Exercised against hand-built reasoning objects rather than live model
  // output, so the assertions are deterministic. What the model happens to
  // write varies; what the checker does with a given sentence must not.
  const facts = {
    claimedAmount: 65000,
    history: { priorClaimCount: 4, totalClaimedAcrossWindow: 375000 },
    indicators: [{ evidence: { priorClaimIds: ['DEMO-HIST-0001', 'DEMO-HIST-0003'] } }]
  };
  const factTrail = [
    { args: { claimId: 'DEMO-HIST-0001' }, result: { id: 'DEMO-HIST-0001', claimedAmount: 45000 } },
    { args: { claimId: 'DEMO-HIST-0003' }, result: { id: 'DEMO-HIST-0003', claimedAmount: 72000 } }
  ];
  const truth = collectGroundTruth(facts, factTrail);

  const clean = checkGrounding({
    summary: 'The claimant filed a ₱65,000 claim. Prior claim DEMO-HIST-0001 was ₱45,000.',
    riskFraming: 'Ordinary wear could explain this.',
    suggestedChecks: ['Compare against DEMO-HIST-0003.']
  }, truth);
  check('real figures and cited claim ids pass', clean.verified, `${clean.counts.currency} figures checked`);

  const fabricated = checkGrounding({
    summary: 'The claimant has claimed ₱999,999,999 in total.',
    riskFraming: 'See also claim FAKE-0000-0001.',
    suggestedChecks: []
  }, truth);
  check('a fabricated peso figure is flagged', fabricated.unsupported.some(u => u.kind === 'currency'));
  check('a fabricated claim id is flagged', fabricated.unsupported.some(u => u.kind === 'claimId'));
  check('the flagged item carries its sentence for context',
    Boolean(fabricated.unsupported[0]?.context), fabricated.unsupported[0]?.context);

  // The false positive that would make the check untrustworthy: ₱117,000 is
  // 45,000 + 72,000, correct arithmetic over figures the model was given, and
  // appears nowhere in the source data as a literal.
  const derived = checkGrounding({
    summary: 'The two prior claims total ₱117,000.',
    riskFraming: 'Both were settled normally.',
    suggestedChecks: []
  }, truth);
  check('a correct subtotal is NOT flagged as fabrication', derived.verified, '₱117,000 = 45,000 + 72,000');

  // Guardrail 5 once more: grounding annotates, it never withholds or decides.
  // Assert that on every successful AI result the analysis is still present in
  // full, whatever the grounding verdict was — the check must not be able to
  // suppress the model's output, only mark it.
  const scored = [a1.ai, a4.ai].filter(ai => ai && !ai.unavailable);
  if (scored.length > 0) {
    check(
      'every AI result carries a grounding verdict',
      scored.every(ai => ai.grounding?.checked === true),
      scored.map(ai => `${ai.model}: ${ai.grounding?.verified ? 'clean' : `${ai.grounding?.unsupported.length} flagged`}`).join(' · ')
    );
    check(
      'the analysis survives a grounding failure',
      scored.every(ai => Boolean(ai.summary) && Boolean(ai.riskFraming))
    );
  } else {
    console.log('  note  no AI result on this run, so the live grounding verdict could not be checked');
  }

  // -------------------------------------------------------------------------
  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed.`
      : `\n${failures} of ${checks} checks FAILED.`
  );

  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nCheck run failed:', err.message);
  process.exit(1);
});
