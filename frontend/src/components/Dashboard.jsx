// dashboard.jsx
import DashboardStats from './dashboard/DashboardStats';
import ClaimTable from './dashboard/ClaimTable';
import ActivitySidebar from './dashboard/ActivitySidebar';

/**
 * Dashboard screen shell — KPI tiles + claims table on the left,
 * activity feed on the right. Pure layout; all data comes from App.jsx.
 */
export default function Dashboard({ claims, activeTab, onTabChange, onSelectClaim, activityLogs }) {
  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto">
        <DashboardStats />
        <ClaimTable
          claims={claims}
          activeTab={activeTab}
          onTabChange={onTabChange}
          onSelectClaim={onSelectClaim}
        />
      </div>

      <ActivitySidebar activityLogs={activityLogs} />
    </div>
  );
}
