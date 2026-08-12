// components/claims/FraudAdvisory.jsx
//
// The Fraud Advisory card — where the backend's advisory is shown to the agent.
//
// WHY THIS LOOKS NOTHING LIKE PolicyRules.jsx
// Policy rules are colour-coded green / amber / red with 🟢🟡🔴 and mean
// "covered / conditional / not covered". This card is violet and uses no
// traffic-light emoji at all, because a fraud signal means something completely
// different: "this may be worth a closer look — go and check". An agent who
// reads an advisory as "not covered" would deny a claim that is probably
// perfectly valid, and one who reads it as an ordinary exclusion would approve
// one that deserved a second look. The two must never be mistakable for one
// another at a glance, so the palettes stay disjoint (guardrail 8).
//
// THIS CARD CANNOT CHANGE ANYTHING. It renders an assessment and navigates to
// evidence. It has no setter for the payout, no setter for the status, and no
// way to disable the approve button. That is guardrails 3 and 4, enforced by
// simply not passing it the means.
//
// It reads `claim.fraudAdvisory`, which the backend wrote. It does not compute
// anything itself — the previous version ran the FR-01 engine in the browser,
// which cannot see the claimant's other claims.

const STATE_STYLES = {
  CLEARED: {
    chip: 'bg-slate-100 text-slate-600 border-slate-300',
    card: 'border-slate-200'
  },
  NOT_CLEARED: {
    chip: 'bg-amber-100 text-amber-900 border-amber-300',
    card: 'border-violet-300 ring-1 ring-violet-100'
  }
};

const CONCERN_STYLES = {
  LOW: 'bg-slate-50 text-slate-500 border-slate-200',
  MODERATE: 'bg-violet-50 text-violet-700 border-violet-200',
  HIGH: 'bg-violet-100 text-violet-800 border-violet-300'
};

/**
 * The disclaimer that appears on every NOT_CLEARED advisory.
 *
 * Fixed copy, no props, not dismissible, and deliberately awkward to remove:
 * this is guardrail 2 rendered as a component. The module's primary signal is
 * claim frequency, and frequency is a risk pattern rather than evidence of
 * deception. A card that showed the indicators without this line would be
 * letting the layout make a claim the data cannot support.
 */
function DisclaimerBar() {
  return (
    <div className="flex gap-2 p-2.5 bg-blue-50/60 border border-blue-200 rounded-lg">
      <span className="text-blue-500 flex-shrink-0">ℹ</span>
      <p className="text-[11px] text-blue-900/90 leading-relaxed">
        This is a warning, not a determination. Frequent or high-value claims are a risk
        pattern, not proof of fraud. Review the indicators and decide.
      </p>
    </div>
  );
}

/** Renders whatever an evidence block actually carries, in a readable line. */
function EvidenceLine({ evidence, onOpenClaim }) {
  if (!evidence) return null;

  const priorIds = evidence.claimIds || evidence.priorClaimIds || [];

  const facts = [];
  if (evidence.count !== undefined) facts.push(`${evidence.count} claims in ${evidence.windowMonths} months`);
  if (evidence.gapDays !== undefined) facts.push(`${evidence.gapDays} days apart`);
  if (evidence.total !== undefined) facts.push(`₱${Number(evidence.total).toLocaleString()} total`);
  if (evidence.part) facts.push(`part: ${evidence.part}`);
  if (evidence.estimate !== undefined) facts.push(`estimate ₱${Number(evidence.estimate).toLocaleString()}`);
  if (evidence.severity) facts.push(`severity ${evidence.severity}`);
  if (evidence.multiple !== undefined) facts.push(`${evidence.multiple}x the band`);
  if (evidence.percentOver !== undefined) facts.push(`${evidence.percentOver}% over`);
  // The FR-01 shape, kept as it was.
  if (evidence.claimedLabel) facts.push(`${evidence.claimedLabel}: ${evidence.claimed}`);
  if (evidence.comparedToLabel) facts.push(`${evidence.comparedToLabel}: ${evidence.comparedTo}`);

  if (facts.length === 0 && priorIds.length === 0) return null;

  return (
    <div className="text-[10px] text-slate-600 font-mono bg-white/70 border border-violet-100 rounded px-2 py-1 space-y-1">
      {facts.length > 0 && <div>{facts.join(' · ')}</div>}

      {priorIds.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-slate-400">prior claims:</span>
          {priorIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpenClaim?.(id)}
              className="underline decoration-dotted text-violet-700 hover:text-violet-900 font-bold"
              title={`Open ${id} in the workspace`}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The AI Analysis panel.
 *
 * When the model was unavailable this renders the reason and NOTHING else.
 * There is deliberately no fallback narrative: a paragraph the model did not
 * write, presented where the model's writing goes, would be indistinguishable
 * from AI reasoning to the person reading it. Guardrail 5 — the module degrades
 * to the rule output plus a clear notice, never to a plausible-sounding
 * substitute.
 */
function AiAnalysis({ ai }) {
  if (!ai) return null;

  if (ai.unavailable) {
    return (
      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">AI Analysis</div>
        <p className="text-[11px] text-slate-500 italic">
          AI reasoning unavailable — {ai.reason} The indicators below are unaffected and were
          produced by the rule engine.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3.5 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-white space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold text-violet-500 uppercase tracking-wide">✨ AI Analysis</div>
        {ai.model && (
          <span className="text-[9px] font-mono bg-white text-violet-500 border border-violet-200 px-1.5 py-0.5 rounded">
            {ai.model}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-800 leading-relaxed font-medium">{ai.summary}</p>

      {ai.reasoning && (
        <p className="text-[11px] text-slate-600 leading-relaxed">{ai.reasoning}</p>
      )}

      {/* Guardrail 2 again, this time specific to THIS claim. The rule layer
          states the general principle; this states what an innocent reading of
          this particular pattern would actually look like. */}
      {ai.riskFraming && (
        <div className="pt-2 border-t border-violet-100">
          <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-1">
            Why this may still be legitimate
          </div>
          <p className="text-[11px] text-slate-700 leading-relaxed">{ai.riskFraming}</p>
        </div>
      )}

      {ai.suggestedChecks?.length > 0 && (
        <div className="pt-2 border-t border-violet-100">
          <div className="text-[10px] font-bold text-violet-500 uppercase tracking-wide mb-1.5">
            Suggested checks
          </div>
          <ul className="space-y-1">
            {ai.suggestedChecks.map((item, index) => (
              <li key={index} className="flex gap-1.5 text-[11px] text-slate-700 leading-relaxed">
                <span className="text-violet-400 flex-shrink-0">☐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One row per raised signal. Identical shape for indicators and observations. */
function SignalRow({ signal, muted, onViewEvidence, onOpenClaim }) {
  return (
    <div
      className={`p-3 rounded-lg border space-y-1.5 ${
        muted ? 'border-slate-200 bg-slate-50/60' : 'border-violet-200 bg-violet-50/40'
      }`}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-mono font-bold ${muted ? 'text-slate-500' : 'text-violet-700'}`}>
          {signal.code}
        </span>
        <h4 className={`text-xs font-bold ${muted ? 'text-slate-600' : 'text-violet-900'}`}>{signal.label}</h4>
        <span className="text-[9px] text-slate-400 uppercase tracking-wide">{signal.category}</span>
      </div>

      <p className={`text-xs leading-relaxed ${muted ? 'text-slate-600' : 'text-violet-900/90'}`}>
        {signal.detail}
      </p>

      <EvidenceLine evidence={signal.evidence} onOpenClaim={onOpenClaim} />

      {/* Reuses App.jsx's existing field-selection handler — the same one the
          HITL panel uses — so this scrolls the document viewer AND selects the
          field. No navigation logic of its own. */}
      {(signal.evidence?.fieldId || signal.evidence?.sourceDoc) && (
        <button
          type="button"
          onClick={() => onViewEvidence?.(signal)}
          className="text-[10px] bg-violet-600 hover:bg-violet-500 text-white font-bold px-2.5 py-1 rounded transition"
        >
          🔍 View evidence
        </button>
      )}
    </div>
  );
}

/** Plain-English description of how the claimant's history was matched. */
const BASIS_LABEL = {
  government_id: 'government ID',
  plate: 'vehicle plate number',
  name_email: 'name and email',
  name_only: 'name only'
};

export default function FraudAdvisory({ advisory, isRunning, onRun, onViewEvidence, onOpenClaim }) {
  // No advisory yet — offer to run one rather than rendering an empty card,
  // which would read as a verdict of "nothing found".
  if (!advisory) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold text-violet-400 uppercase tracking-wider">Fraud Advisory</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Not yet run for this claim. No signals have been assessed either way.
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className={`text-xs font-bold px-3 py-2 rounded-lg transition shadow-sm flex-shrink-0 ${
            isRunning
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          {isRunning ? 'Running…' : 'Run advisory'}
        </button>
      </div>
    );
  }

  const {
    state,
    concern,
    headline,
    indicators = [],
    observations = [],
    suppressed = [],
    skipped = [],
    history,
    ai,
    engineVersion,
    evaluatedAt
  } = advisory;

  const styles = STATE_STYLES[state] || STATE_STYLES.CLEARED;
  const isNotCleared = state === 'NOT_CLEARED';
  const impreciseMatch = history?.basis === 'plate' || history?.basis === 'name_only';

  return (
    <div className={`bg-white rounded-xl border p-4 shadow-sm space-y-3 ${styles.card}`}>

      {/* 1. HEADER */}
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-xs font-bold text-violet-400 uppercase tracking-wider">Fraud Advisory</h2>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded border whitespace-nowrap ${styles.chip}`}>
            {isNotCleared ? 'NOT CLEARED' : 'CLEARED'}
          </span>
          <span
            className={`text-[10px] font-bold px-2 py-1 rounded border whitespace-nowrap ${CONCERN_STYLES[concern] || CONCERN_STYLES.LOW}`}
            title="Used to order the review queue. It is not a measure of suspicion and nothing acts on it."
          >
            {concern}
          </span>
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className="text-[10px] font-bold text-violet-600 hover:text-violet-800 disabled:text-slate-400 px-1.5 py-1"
            title="Re-run the advisory against the current data"
          >
            {isRunning ? '…' : '↻'}
          </button>
        </div>
      </div>

      {/* 2. HEADLINE */}
      <p className={`text-sm font-bold ${isNotCleared ? 'text-violet-900' : 'text-slate-600'}`}>
        {headline}
      </p>

      {/* 3. DISCLAIMER — required on every NOT_CLEARED advisory. */}
      {isNotCleared && <DisclaimerBar />}

      {/* 4. AI ANALYSIS */}
      <AiAnalysis ai={ai} />

      {/* 5. INDICATORS */}
      {indicators.map((signal) => (
        <SignalRow
          key={signal.code}
          signal={signal}
          onViewEvidence={onViewEvidence}
          onOpenClaim={onOpenClaim}
        />
      ))}

      {indicators.length === 0 && suppressed.length === 0 && observations.length === 0 && (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs text-emerald-900 font-semibold">
          <span>✓</span>
          <span>No fraud indicators found.</span>
        </div>
      )}

      {/* 6. OBSERVATIONS — collapsed, but visible on purpose. Hiding what the
          system noticed and chose not to escalate would make the two
          indistinguishable from the outside. */}
      {observations.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[10px] font-bold text-slate-400 uppercase tracking-wide hover:text-slate-600">
            {observations.length} observation{observations.length === 1 ? '' : 's'} noted (did not raise a warning)
          </summary>
          <div className="mt-2 space-y-2">
            {observations.map((signal) => (
              <SignalRow
                key={signal.code}
                signal={signal}
                muted
                onViewEvidence={onViewEvidence}
                onOpenClaim={onOpenClaim}
              />
            ))}
          </div>
        </details>
      )}

      {/* 7. SUPPRESSED — visible on purpose. Showing what the system decided NOT
          to raise is the difference between a judgement and a black box. */}
      {suppressed.map((item) => (
        <div key={item.code} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1 opacity-80">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400">⊘</span>
            <span className="text-[10px] font-mono font-bold text-slate-500">{item.code}</span>
            <h4 className="text-xs font-bold text-slate-600 line-through">{item.label}</h4>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-slate-200 text-slate-600 border-slate-300 uppercase">
              Not raised
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{item.detail}</p>
          <p className="text-[10px] text-slate-500 italic">Not raised: {item.suppressionReason}</p>
        </div>
      ))}

      {/* 8. NOT EVALUATED — the rules that could not run for want of data. An
          advisory that reported CLEARED while silently skipping half its
          catalogue would be actively misleading, so the gaps are on screen. */}
      {skipped.length > 0 && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer font-bold text-slate-400 uppercase tracking-wide hover:text-slate-600">
            {skipped.length} rule{skipped.length === 1 ? '' : 's'} not evaluated — data missing
          </summary>
          <ul className="mt-1.5 space-y-1 pl-1">
            {skipped.map((item) => (
              <li key={item.code} className="flex gap-1.5">
                <span className="font-mono text-slate-400 flex-shrink-0">{item.code}</span>
                <span>{item.label} — needs {(item.missing || []).join(', ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 9. FOOTER — how the history was matched, and how far to trust it. */}
      <div className="text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-100 space-y-0.5">
        <div>
          Engine {engineVersion} · evaluated {evaluatedAt ? new Date(evaluatedAt).toLocaleString() : 'unknown'}
        </div>
        {history?.basis ? (
          <div>
            History matched on {BASIS_LABEL[history.basis] || history.basis} ({history.confidence} confidence),
            {' '}{history.claimCount} prior claim{history.claimCount === 1 ? '' : 's'} in {history.windowYears} years
          </div>
        ) : (
          <div>No identifier available to match this claimant's history on.</div>
        )}
        {impreciseMatch && (
          <div className="text-amber-600 not-italic">
            ⚠ This match may be imprecise.
            {history.basis === 'plate'
              ? ' A plate follows the vehicle, so a change of owner can group two different people.'
              : ' Matching on name alone can group unrelated people who share a name.'}
          </div>
        )}
      </div>
    </div>
  );
}
