/**
 * Preview of the decision-notice email sent to the policyholder.
 * The body text switches between the approved and denied wording.
 */
export default function EmailModal({
  isOpen,
  activeClaim,
  approvedPayout,
  isModified,
  overrideReason,
  denialReason,
  onClose,
  onSend
}) {
  if (!isOpen) return null;

  const isDenied = activeClaim.status === 'Denied';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-base font-bold text-slate-900">📧 Policyholder Email Preview</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
        </div>

        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3 font-sans text-xs">
          <div className="border-b border-slate-200 pb-2 space-y-1">
            <p><strong>To:</strong> {activeClaim.policyholder} &lt;{activeClaim.email}&gt;</p>
            <p><strong>Subject:</strong> Claim Decision Notification - {activeClaim.id}</p>
          </div>

          <div className="space-y-2 text-slate-700 leading-relaxed">
            <p>Dear {activeClaim.policyholder},</p>
            <p>
              We have completed the formal review of your insurance claim <strong>{activeClaim.id}</strong> regarding vehicle <strong>{activeClaim.vehicle}</strong>.
            </p>

            <div className="p-3 bg-white rounded border border-slate-200 font-mono space-y-1">
              <p><strong>Claim Status:</strong> {isDenied ? 'REJECTED / DENIED' : isModified ? 'APPROVED WITH ADJUSTMENTS' : 'APPROVED'}</p>
              <p><strong>Claimed Amount:</strong> ₱{(activeClaim.claimedAmount || 0).toLocaleString()}</p>
              <p><strong>Final Approved Payout:</strong> ₱{isDenied ? '0' : approvedPayout.toLocaleString()}</p>
            </div>

            {isDenied && denialReason && (
              <p className="italic bg-red-50 p-2.5 rounded text-red-900 border border-red-200">
                <strong>Reason for Rejection:</strong> "{denialReason}"
              </p>
            )}

            {isModified && overrideReason && !isDenied && (
              <p className="italic bg-amber-50 p-2.5 rounded text-amber-900 border border-amber-200">
                <strong>Adjuster Note:</strong> "{overrideReason}"
              </p>
            )}

            <p>
              {isDenied
                ? 'If you have additional questions regarding this decision, please reach out to our claims office.'
                : 'Payment disbursement will be processed shortly. Thank you for choosing InsureCopilot.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-2">
          <button onClick={onClose} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg">
            Cancel
          </button>
          <button
            onClick={onSend}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
          >
            🚀 Confirm & Send Email
          </button>
        </div>
      </div>
    </div>
  );
}
