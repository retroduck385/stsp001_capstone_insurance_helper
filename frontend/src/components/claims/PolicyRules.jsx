/**
 * Automated policy rules / flags list plus exclusions & the master policy citation.
 * - relevant_provisions -> rendered as "rules" (green: coverage applies)
 * - exclusions_or_limitations -> rendered as "limitations" (red: coverage restricted/denied)
 * Each item shape: { section: string, explanation: string }
 */
// policyrules.jsx
export default function PolicyRules(props) {
  const {
    relevant_provisions,
    exclusions_or_limitations,
    // fallback names in case the parent still passes the old prop shape
    rules: rulesProp,
    limitations: limitationsProp,
    // fallback in case the parent passes the whole record as one object
    data,
    record,
    citation: citationProp,
  } = props;

  const source = data || record || {};

  const rules =
    relevant_provisions ||
    rulesProp ||
    source.relevant_provisions ||
    source.relevantProvisions ||
    source.provisions ||
    [];

  const limitations =
    exclusions_or_limitations ||
    limitationsProp ||
    source.exclusions_or_limitations ||
    source.exclusionsOrLimitations ||
    source.limitations ||
    [];

  const citation = citationProp || source.citation;

  // Debug: keep this on until the data is confirmed flowing correctly, then remove.
  console.log('PolicyRules resolved:', { rulesCount: rules.length, limitationsCount: limitations.length, rawProps: props });

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Automated Policy Rules & Flags</h2>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">Dynamic Evaluation Active</span>
        </div>

        {rules.map((rule, idx) => (
          <div
            key={`rule-${idx}`}
            className="flex items-start space-x-3 p-3 rounded-lg border bg-emerald-50/60 border-emerald-200 text-emerald-900"
          >
            <span className="text-base">🟢</span>
            <div>
              <h4 className="text-xs font-bold">{rule.section}</h4>
              <p className="text-xs opacity-90">{rule.explanation}</p>
            </div>
          </div>
        ))}

        {limitations.map((limitation, idx) => (
          <div
            key={`limitation-${idx}`}
            className="flex items-start space-x-3 p-3 rounded-lg border bg-red-50/60 border-red-200 text-red-900"
          >
            <span className="text-base">🔴</span>
            <div>
              <h4 className="text-xs font-bold">{limitation.section}</h4>
              <p className="text-xs opacity-90">{limitation.explanation}</p>
            </div>
          </div>
        ))}

        {rules.length === 0 && limitations.length === 0 && (
          <p className="text-xs text-slate-400 italic">No provisions or exclusions available.</p>
        )}
      </div>

      {citation && (
        <div className="bg-slate-900 text-slate-300 rounded-xl p-4 shadow-sm space-y-2">
          <span className="text-xs font-bold text-blue-400 block border-b border-slate-800 pb-1">📌 Master Policy Contract Citation</span>
          <p className="text-xs italic leading-relaxed">"{citation}"</p>
        </div>
      )}
    </>
  );
}