import PolicyRules from './PolicyRules';
import FraudAdvisory from './FraudAdvisory';
import DecisionPanel from './DecisionPanel';

/**
 * Right panel of the claim workspace.
 * Owns the assessment metrics block (claimed amount / approved payout / policy
 * status) and stacks the policy rules and decision bar below it.
 */
export default function ClaimAssessment({
  activeClaim,
  approvedPayout,
  isModified,
  overrideReason,
  denialReason,
  emailSent,
  decision,
  fraud
}) {
  const isDenied = activeClaim.status === 'Denied';

  return (
    <section className="w-1/2 flex flex-col space-y-4 overflow-y-auto pr-1">

      {/* ASSESSMENT METRICS */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">AI Copilot Claim Assessment</h2>
          {isModified && (
            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded border border-amber-300">
              ✏️ Adjuster Modified
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <span className="text-xs text-slate-500 block">Claimed Amount</span>
            <span className="text-lg font-bold text-slate-900">₱{(activeClaim.claimedAmount || 0).toLocaleString()}</span>
          </div>
          <div className={`p-3 rounded-lg border ${isDenied ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
            <span className={`text-xs block ${isDenied ? 'text-red-600' : 'text-blue-600'}`}>
              Approved Payout
            </span>
            <span className={`text-lg font-bold ${isDenied ? 'text-red-700' : 'text-blue-700'}`}>
              ₱{isDenied ? '0' : approvedPayout.toLocaleString()}
            </span>
          </div>
          <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
            <span className="text-xs text-emerald-600 block">Policy Status</span>
            <span className="text-sm font-bold text-emerald-700">Active Coverage</span>
          </div>
        </div>

        {isModified && overrideReason && (
          <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <strong>Adjuster Notes:</strong> "{overrideReason}"
          </div>
        )}

        {isDenied && denialReason && (
          <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
            <strong>Reason for Claim Rejection:</strong> "{denialReason}"
          </div>
        )}
      </div>

      <PolicyRules rules={activeClaim.rules} citation={activeClaim.citation} />

      {/* The advisory sits between the policy verdict and the decision bar, so
          the agent cannot reach Approve without having scrolled past it. The
          plan called for it above the policy citation; the citation is rendered
          inside PolicyRules, so it goes directly below that pair instead — same
          position in the reading order that matters, without splitting that
          component. */}
      <FraudAdvisory
        advisory={fraud?.advisory}
        isRunning={fraud?.isRunning}
        onRun={fraud?.onRun}
        onViewEvidence={fraud?.onViewEvidence}
        onOpenClaim={fraud?.onOpenClaim}
      />

      <DecisionPanel
        activeClaim={activeClaim}
        approvedPayout={approvedPayout}
        emailSent={emailSent}
        onApprove={decision.onApprove}
        onEditPayout={decision.onEditPayout}
        onDeny={decision.onDeny}
        onSendEmail={decision.onSendEmail}
      />

    </section>
  );
}