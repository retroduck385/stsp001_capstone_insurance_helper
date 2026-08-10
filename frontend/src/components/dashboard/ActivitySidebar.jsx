/**
 * Right-hand activity feed on the dashboard.
 * Logs are pushed by App.jsx's runAiAnalysis / OCR correction handlers.
 */
export default function ActivitySidebar({ activityLogs }) {
  return (
    <aside className="w-80 bg-white border-l border-slate-200 p-4 flex flex-col space-y-4 flex-shrink-0">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2">
          <span>🔔 Activity & Real-Time Alerts</span>
        </h3>
        <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">{activityLogs.length} New</span>
      </div>

      <div className="space-y-3 flex-1 overflow-y-auto">
        {activityLogs.map(log => (
          <div key={log.id} className={`p-3 rounded-lg text-xs space-y-1 shadow-sm border ${
            log.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
            log.type === 'danger' ? 'bg-red-50 border-red-200 text-red-900' :
            log.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}>
            <div className="flex justify-between font-bold">
              <span>{log.type === 'success' ? '⚡ AI Re-evaluated' : log.type === 'danger' ? '🚫 Exception Flagged' : '⚠️ System Alert'}</span>
              <span className="text-slate-400 font-normal">{log.time}</span>
            </div>
            <p className="opacity-90">{log.text}</p>
          </div>
        ))}
      </div>

      <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-500 border border-slate-200">
        👤 <strong>Adjuster:</strong> Ethan Jackson (Senior Claims)
      </div>
    </aside>
  );
}
