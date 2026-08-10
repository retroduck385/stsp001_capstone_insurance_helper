/**
 * Payout override form. Saving approves the claim at the adjusted amount;
 * a written reason is required (checked in App.jsx's handleSaveAndApproveEdit).
 */
export default function EditPayoutModal({
  isOpen,
  approvedPayout,
  onApprovedPayoutChange,
  overrideReason,
  onOverrideReasonChange,
  onClose,
  onSave
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-base font-bold text-slate-900">Modify Claim Payout & Add Comments</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
        </div>

        <p className="text-xs text-slate-500">Enter your revised payout figure and explain your reasoning in the comments field below for regulatory compliance.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Adjusted Approved Payout (PHP)</label>
            <input
              type="number"
              value={approvedPayout}
              onChange={(e) => onApprovedPayoutChange(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Adjuster Comments & Reason for Modification *</label>
            <textarea
              rows="3"
              placeholder="Enter specific comments or reasons for overriding payout (e.g., Excluded battery per policy section II, goodwill consideration granted)..."
              value={overrideReason}
              onChange={(e) => onOverrideReasonChange(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
            ></textarea>
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={onSave}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
          >
            ✓ Save & Approve Modified Payout
          </button>
        </div>
      </div>
    </div>
  );
}
