/**
 * Claim denial form. A written reason is required for regulatory compliance —
 * the check lives in App.jsx's handleConfirmDenial.
 */
export default function DenyClaimModal({ isOpen, activeClaim, denialReason, onDenialReasonChange, onClose, onConfirm }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-red-100">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-base font-bold text-red-700 flex items-center space-x-1">
            <span>🚫 Reject / Deny Insurance Claim</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
        </div>

        <p className="text-xs text-slate-500">
          You are about to deny claim <strong>{activeClaim.id}</strong>. Please provide a formal explanation and contractual basis for the rejection notification.
        </p>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Rejection / Denying Claim *</label>
          <textarea
            rows="4"
            placeholder="E.g., Claim rejected due to lack of Acts of Nature rider, driving with an expired license, or policy exclusion..."
            value={denialReason}
            onChange={(e) => onDenialReasonChange(e.target.value)}
            className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-red-500 outline-none"
          ></textarea>
        </div>

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
          >
            Confirm Claim Rejection
          </button>
        </div>
      </div>
    </div>
  );
}
