/**
 * The three KPI tiles across the top of the dashboard.
 * NOTE: the counts are still hardcoded placeholders — they are not derived
 * from claimsDb yet.
 */
// dashboardstats.jsx
export default function DashboardStats() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">All Open Workload</span>
        <span className="text-2xl font-extrabold text-blue-600">4 Claims</span>
        <span className="text-xs text-blue-600 font-medium block mt-1">Pending active review</span>
      </div>
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Flagged / Exceptions</span>
        <span className="text-2xl font-extrabold text-amber-600">3 Claims</span>
        <span className="text-xs text-amber-600 font-medium block mt-1">Requires manual investigation</span>
      </div>
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Clean / Straight-Through</span>
        <span className="text-2xl font-extrabold text-emerald-600">1 Claim</span>
        <span className="text-xs text-emerald-600 font-medium block mt-1">Ready for 1-click approval</span>
      </div>
    </div>
  );
}
