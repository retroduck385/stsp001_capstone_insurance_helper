/**
 * Final decision bar: the payout figure plus Approve / Edit Payout / Deny.
 * Once the claim is Completed or Denied the buttons are replaced by a sealed
 * status badge and the policyholder email notification row appears.
 *
 *
 * ── WHY THE FRAUD ADVISORY DOES NOT APPEAR ANYWHERE IN THIS FILE ────────────
 * This component takes no advisory prop, has no disabled state tied to one, and
 * has no "refer to investigation" action. That is deliberate and it is the
 * single most important design decision in the fraud module.
 *
 * The advisory rests substantially on claim frequency. Frequency is a
 * well-established trigger for investigation and equally well established as
 * NOT being evidence of fraud — a policyholder with four legitimate claims from
 * four separate verifiable events is a high-risk customer, not a fraudster, and
 * nothing in a count of claims can establish intent. A module that greyed out
 * Approve or held a payout on that basis would be asserting something its
 * inputs cannot support, against a real person's money.
 *
 * So the warning is non-blocking by construction rather than by convention: the
 * means to block simply are not passed to this component. What the module may
 * do is ask the agent to acknowledge the advisory in writing before approving —
 * see FraudAcknowledgementModal.jsx, which App.jsx opens instead of approving.
 * It records the decision; it never prevents it.
 *
 * If a future change wants to gate approval on the advisory, that is a change
 * to the module's claim about what it knows, not a UI tweak. Read CLAUDE.md
 * guardrails 2 and 3 first.
 */
export default function DecisionPanel({
  activeClaim,
  approvedPayout,
  emailSent,
  onApprove,
  onEditPayout,
  onDeny,
  onSendEmail
}) {
  const isDenied = activeClaim.status === 'Denied';
  const isClosed = activeClaim.status === 'Completed' || isDenied;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-400 block">Final Decision Payout</span>
          <span className={`text-xl font-extrabold ${isDenied ? 'text-red-600' : 'text-slate-900'}`}>
            ₱{isDenied ? '0' : approvedPayout.toLocaleString()}
          </span>
        </div>

        <div className="flex space-x-2">
          {activeClaim.status === 'In Assessment' ? (
            <>
              <button
                onClick={onApprove}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3.5 py-2.5 rounded-lg transition shadow-sm flex items-center space-x-1"
              >
                <span>⚡ Approve</span>
              </button>
              <button
                onClick={onEditPayout}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-lg border border-slate-300 transition"
              >
                ✏️ Edit Payout
              </button>
              <button
                onClick={onDeny}
                className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-2.5 rounded-lg transition shadow-sm"
              >
                🚫 Deny Claim
              </button>
            </>
          ) : isDenied ? (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-red-700 font-bold bg-red-50 px-3 py-2 rounded-lg border border-red-200">
                ✕ Claim Denied & Sealed
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                ✓ Claim Approved & Signed
              </span>
            </div>
          )}
        </div>
      </div>

      {isClosed && (
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between bg-blue-50/50 p-3 rounded-lg border border-blue-100">
          <div>
            <div className="text-xs font-bold text-slate-800">Policyholder Notification</div>
            <div className="text-[11px] text-slate-500">
              {emailSent ? '✓ Email dispatch confirmed.' : `Send decision notice to ${activeClaim.email}`}
            </div>
          </div>
          <button
            onClick={onSendEmail}
            disabled={emailSent}
            className={`text-xs font-bold px-3 py-2 rounded-lg transition shadow-sm ${
              emailSent
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {emailSent ? '✓ Email Sent' : '📧 Send Email to Policyholder'}
          </button>
        </div>
      )}
    </div>
  );
}
