// Dashboard filter tabs. The ids are matched against claim status in App.jsx's
// `filteredClaims` derivation — keep the two in sync when adding a tab.
const TABS = [
  { id: 'All Open', label: 'All Open' },
  { id: 'Flagged / Exceptions', label: '⚠️ Flagged / Exceptions' },
  { id: 'Clean / Straight-Through', label: '⚡ Clean / Straight-Through' },
  { id: 'Completed', label: '✓ Processed & Completed' }
];

/**
 * Tab strip + the claims table. Rows are already filtered by App.jsx.
 */
export default function ClaimTable({ claims, activeTab, onTabChange, onSelectClaim }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50/50 px-4 pt-3 flex space-x-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-lg transition border-b-2 ${
              activeTab === tab.id ? 'bg-white text-blue-700 border-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-semibold uppercase">
              <th className="py-3 px-4">Claim ID & Policyholder</th>
              <th className="py-3 px-4">Vehicle</th>
              <th className="py-3 px-4">Claimed Amount</th>
              <th className="py-3 px-4">Flags & Summary</th>
              <th className="py-3 px-4 text-center">Docs</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {claims.map((claim) => (
              <tr key={claim.id} className="hover:bg-blue-50/40 transition cursor-pointer" onClick={() => onSelectClaim(claim.id)}>
                <td className="py-3.5 px-4">
                  <div className="font-bold text-blue-700">{claim.id}</div>
                  <div className="text-xs text-slate-500">{claim.policyholder}</div>
                </td>
                <td className="py-3.5 px-4 text-xs">{claim.vehicle}</td>
                <td className="py-3.5 px-4 font-semibold text-xs">₱{(claim.claimedAmount || 0).toLocaleString()}</td>
                <td className="py-3.5 px-4 text-xs font-bold">{claim.flagSummary}</td>
                <td className="py-3.5 px-4 text-center">
                  <span className="inline-flex items-center space-x-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                    📄 {claim.docsCount}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right">
                  <button className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded transition shadow-sm">
                    Open Workspace →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
