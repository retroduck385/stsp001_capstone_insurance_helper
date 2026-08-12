/**
 * The KPI tiles across the top of the dashboard.
 *
 * These used to be hardcoded ("4 Claims / 3 Claims / 1 Claim") and took no
 * props at all, so they could — and did — contradict the table right below
 * them. They are now derived from the same claim data, using the SAME
 * predicates as App.jsx's `filteredClaims`, and each tile switches to its tab.
 *
 * `claims` must be EVERY claim, not the filtered subset — otherwise each tile
 * would only ever count the tab that is already open.
 */

import { needsIntegrityReview } from '../../services/fraudEngine';

// One entry per dashboard tab. `id` must match the tab ids in ClaimTable.jsx
// and the branches of `filteredClaims` in App.jsx.
//
// `matches` receives (claim, fraudResults) — the second argument exists solely
// for the Integrity Review tile, whose predicate depends on the FR-01 engine's
// verdict rather than on anything stored on the claim.
const TILES = [
  {
    id: 'All Open',
    label: 'All Open Workload',
    caption: 'Pending active review',
    matches: (claim) => claim.status === 'In Assessment',
    valueClass: 'text-blue-600',
    captionClass: 'text-blue-600',
    activeClass: 'border-blue-400 ring-1 ring-blue-200'
  },
  {
    id: 'Flagged / Exceptions',
    label: 'Flagged / Exceptions',
    caption: 'Requires manual investigation',
    matches: (claim) => claim.status === 'In Assessment' && claim.isFlagged,
    valueClass: 'text-amber-600',
    captionClass: 'text-amber-600',
    activeClass: 'border-amber-400 ring-1 ring-amber-200'
  },
  {
    id: 'Clean / Straight-Through',
    label: 'Clean / Straight-Through',
    caption: 'Ready for 1-click approval',
    matches: (claim) => claim.status === 'In Assessment' && !claim.isFlagged,
    valueClass: 'text-emerald-600',
    captionClass: 'text-emerald-600',
    activeClass: 'border-emerald-400 ring-1 ring-emerald-200'
  },
  {
    // Violet, and nothing else on this dashboard is violet. The policy engine
    // owns green/amber/red and they mean coverage; violet means integrity.
    // Keeping the palettes disjoint is deliberate — see ClaimIntegrity.jsx.
    id: 'Integrity Review',
    label: 'Integrity Review',
    caption: 'Requires verification or SIU referral',
    matches: (claim, fraudResults) =>
      claim.status === 'In Assessment' && needsIntegrityReview(fraudResults?.[claim.id]),
    valueClass: 'text-violet-600',
    captionClass: 'text-violet-600',
    activeClass: 'border-violet-400 ring-1 ring-violet-200'
  },
  {
    id: 'Completed',
    label: 'Processed & Completed',
    caption: 'Approved or denied',
    matches: (claim) => claim.status === 'Completed' || claim.status === 'Denied',
    valueClass: 'text-slate-700',
    captionClass: 'text-slate-500',
    activeClass: 'border-slate-400 ring-1 ring-slate-200'
  }
];

export default function DashboardStats({ claims = [], fraudResults = {}, activeTab, onTabChange }) {
  return (
    <div className="grid grid-cols-5 gap-4">
      {TILES.map((tile) => {
        const count = claims.filter(claim => tile.matches(claim, fraudResults)).length;
        const isActive = activeTab === tile.id;

        return (
          <button
            key={tile.id}
            type="button"
            onClick={() => onTabChange?.(tile.id)}
            className={`bg-white p-4 rounded-xl border shadow-sm text-left transition hover:shadow-md hover:border-slate-300 ${
              isActive ? tile.activeClass : 'border-slate-200'
            }`}
          >
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">{tile.label}</span>
            <span className={`text-2xl font-extrabold ${tile.valueClass}`}>
              {count} {count === 1 ? 'Claim' : 'Claims'}
            </span>
            <span className={`text-xs font-medium block mt-1 ${tile.captionClass}`}>{tile.caption}</span>
          </button>
        );
      })}
    </div>
  );
}
