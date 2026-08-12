// components/claims/ClaimIntegrity.jsx
//
// The Claim Integrity Assessment card — where the FR-01 engine's verdict is
// shown to the adjuster.
//
// WHY THIS LOOKS NOTHING LIKE PolicyRules.jsx
// Policy rules are colour-coded green / amber / red with 🟢🟡🔴 and mean
// "covered / conditional / not covered". This card is violet and uses no
// traffic-light emoji at all, because an integrity signal means something
// completely different: "this may not be what it claims to be — go and check".
// An adjuster who reads a REFER as "not covered" would deny a claim that might
// be perfectly valid, and one who reads it as an ordinary exclusion would
// approve a claim that needs investigating. The two must never be able to be
// mistaken for one another at a glance, so the palettes are kept disjoint.
//
// Nothing here can change the payout. The card renders a verdict and navigates
// to evidence; that is its entire remit.

import { BAND_MEANING } from '../../services/fraudEngine';

const BAND_STYLES = {
  CLEAR: {
    badge: 'bg-slate-100 text-slate-600 border-slate-300',
    card: 'border-slate-200',
    accent: 'text-slate-500'
  },
  VERIFY: {
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    card: 'border-violet-200',
    accent: 'text-violet-700'
  },
  REFER: {
    badge: 'bg-violet-600 text-white border-violet-700',
    card: 'border-violet-300 ring-1 ring-violet-100',
    accent: 'text-violet-700'
  }
};

/** Small violet chip used for the score badge and the severity tags. */
function SeverityTag({ severity }) {
  const isHard = severity === 'hard';
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${
        isHard ? 'bg-violet-100 text-violet-800 border-violet-200' : 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
      title={isHard ? 'A factual contradiction between documents' : 'A pattern worth noting; cannot escalate a claim on its own'}
    >
      {isHard ? 'Hard' : 'Soft'}
    </span>
  );
}

export default function ClaimIntegrity({ result, onViewEvidence }) {
  // No result yet (claims still loading, or the engine has not run) — render
  // nothing rather than an empty card that looks like a verdict of "clean".
  if (!result) return null;

  const { score, band, hits = [], suppressed = [], skipped = [], engineVersion, evaluatedAt } = result;
  const styles = BAND_STYLES[band] || BAND_STYLES.CLEAR;
  const isQuiet = hits.length === 0 && suppressed.length === 0;

  return (
    <div className={`bg-white rounded-xl border p-4 shadow-sm space-y-3 ${styles.card}`}>

      {/* HEADER */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-violet-400 uppercase tracking-wider">Claim Integrity Assessment</h2>
          <span className="text-[9px] bg-violet-50 text-violet-500 border border-violet-100 px-1.5 py-0.5 rounded font-mono">
            FR-01
          </span>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded border whitespace-nowrap ${styles.badge}`}>
          {score} · {band}
        </span>
      </div>

      <p className={`text-[11px] font-semibold ${styles.accent}`}>{BAND_MEANING[band]}</p>

      {/* EMPTY STATE */}
      {isQuiet && (
        <div className="flex items-center gap-2 p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs text-emerald-900 font-semibold">
          <span>✓</span>
          <span>No integrity signals detected.</span>
        </div>
      )}

      {/* HITS */}
      {hits.map((hit) => (
        <div key={hit.code} className="p-3 rounded-lg border border-violet-200 bg-violet-50/40 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-bold text-violet-700">{hit.code}</span>
                <h4 className="text-xs font-bold text-violet-900">{hit.label}</h4>
                <SeverityTag severity={hit.severity} />
              </div>
              <span className="text-[9px] text-violet-400 uppercase tracking-wide">{hit.category}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono flex-shrink-0" title="Contribution to the integrity score">
              +{hit.weight}
            </span>
          </div>

          <p className="text-xs text-violet-900/90 leading-relaxed">{hit.detail}</p>

          {/* Evidence values, stated plainly. Guardrail 4: a hit without these
              would not have fired in the first place. */}
          <div className="text-[10px] text-slate-500 font-mono bg-white/70 border border-violet-100 rounded px-2 py-1">
            {hit.evidence.claimedLabel}: <strong>{hit.evidence.claimed}</strong>
            {hit.evidence.comparedTo && (
              <> · {hit.evidence.comparedToLabel}: <strong>{hit.evidence.comparedTo}</strong></>
            )}
          </div>

          {/* Reuses App.jsx's existing field-selection handler — the same one the
              HITL panel uses — so this scrolls the document viewer AND selects
              the field. No navigation logic of its own. */}
          {hit.evidence.fieldId && (
            <button
              type="button"
              onClick={() => onViewEvidence?.(hit)}
              className="text-[10px] bg-violet-600 hover:bg-violet-500 text-white font-bold px-2.5 py-1 rounded transition"
            >
              🔍 View evidence
            </button>
          )}
        </div>
      ))}

      {/* SUPPRESSED — visible on purpose. Showing what the system decided NOT to
          raise is the difference between a judgement and a black box. */}
      {suppressed.map((item) => (
        <div key={item.code} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1 opacity-75">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400">⊘</span>
            <span className="text-[10px] font-mono font-bold text-slate-500">{item.code}</span>
            <h4 className="text-xs font-bold text-slate-600 line-through">{item.label}</h4>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-slate-200 text-slate-600 border-slate-300 uppercase">
              Suppressed
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{item.detail}</p>
          <p className="text-[10px] text-slate-500 italic">Not raised: {item.suppressionReason}</p>
        </div>
      ))}

      {/* NOT EVALUATED — the rules that could not run for want of data.
          An engine that reported CLEAR while silently skipping half its
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
                <span>
                  {item.label} — needs {item.missing.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-100">
        Engine {engineVersion} · evaluated {new Date(evaluatedAt).toLocaleString()}
      </div>
    </div>
  );
}
