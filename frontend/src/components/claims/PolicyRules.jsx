/**
 * Automated policy rules / flags list plus the master policy citation.
 * Rules are colour-coded by rule.type: green (pass), yellow (warning), red (violation).
 */
export default function PolicyRules({ rules, citation }) {
  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Automated Policy Rules & Flags</h2>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">Dynamic Evaluation Active</span>
        </div>
        {(rules || []).map((rule, idx) => (
          <div key={idx} className={`flex items-start space-x-3 p-3 rounded-lg border ${
            rule.type === 'green' ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900' :
            rule.type === 'yellow' ? 'bg-amber-50/60 border-amber-200 text-amber-900' : 'bg-red-50/60 border-red-200 text-red-900'
          }`}>
            <span className="text-base">{rule.type === 'green' ? '🟢' : rule.type === 'yellow' ? '🟡' : '🔴'}</span>
            <div>
              <h4 className="text-xs font-bold">{rule.title}</h4>
              <p className="text-xs opacity-90">{rule.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-900 text-slate-300 rounded-xl p-4 shadow-sm space-y-2">
        <span className="text-xs font-bold text-blue-400 block border-b border-slate-800 pb-1">📌 Master Policy Contract Citation</span>
        <p className="text-xs italic leading-relaxed">"{citation}"</p>
      </div>
    </>
  );
}
