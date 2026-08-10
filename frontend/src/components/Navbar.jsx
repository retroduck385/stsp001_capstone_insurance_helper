/**
 * Top navigation bar.
 * On the dashboard it shows the adjuster identity; on the claim workspace it
 * swaps to the claim context (id / insured), a back button and a status pill.
 */
export default function Navbar({ currentScreen, activeClaim, onBackToDashboard }) {
  const isDetail = currentScreen === 'detail';

  return (
    <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-md flex-shrink-0">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <span className="text-xl font-bold tracking-tight text-blue-400">InsureCopilot</span>
          <span className="text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded border border-blue-700 font-mono">ADJUSTER WORKSPACE</span>
        </div>
        {isDetail && (
          <>
            <span className="text-slate-600">|</span>
            <div className="text-sm"><span className="text-slate-400">Claim ID:</span> <span className="font-semibold text-white">{activeClaim.id}</span></div>
            <div className="text-sm"><span className="text-slate-400">Insured:</span> <span className="font-semibold text-white">{activeClaim.policyholder}</span></div>
          </>
        )}
      </div>

      <div className="flex items-center space-x-4">
        {isDetail ? (
          <>
            <button onClick={onBackToDashboard} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-700 transition">
              ← Back to Dashboard
            </button>
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
              activeClaim.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
              activeClaim.status === 'Denied' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
              'bg-blue-500/20 text-blue-300 border border-blue-500/30'
            }`}>
              {activeClaim.status}
            </span>
          </>
        ) : (
          <div className="flex items-center space-x-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-white">Ethan Jackson</div>
              <div className="text-xs text-slate-400">Claims Adjuster</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center border-2 border-blue-400">EJ</div>
          </div>
        )}
      </div>
    </header>
  );
}
