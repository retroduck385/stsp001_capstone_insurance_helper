/**
 * Shown once when the agent approves a claim that has an outstanding fraud
 * advisory. A written note is required — the check lives in App.jsx's
 * handleAcknowledgeAndApprove.
 *
 * WHAT THIS MODAL IS NOT.
 * It is not a gate. There is no path through this component that refuses the
 * approval, and the approve button behind it is never disabled. The agent can
 * write one sentence and proceed. That is the design, not an oversight — see
 * the comment in DecisionPanel.jsx.
 *
 * What it does do is create a record: what the advisory said, which indicators
 * stood at that moment, and why the agent approved anyway. Over time that log
 * is the only source of labelled outcomes this system will ever have, which is
 * what would let the thresholds be calibrated against reality rather than
 * against judgement.
 *
 * Violet, like the advisory card, and NOT red — red belongs to denial and to
 * policy exclusions. An acknowledgement is neither.
 */
export default function FraudAcknowledgementModal({ isOpen, advisory, note, onNoteChange, onClose, onConfirm }) {
  if (!isOpen || !advisory) return null;

  const indicators = advisory.indicators || [];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-violet-200">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-base font-bold text-violet-800">Fraud advisory outstanding</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
        </div>

        <p className="text-xs font-semibold text-slate-700">{advisory.headline}</p>

        {indicators.length > 0 && (
          <ul className="space-y-1 bg-violet-50/50 border border-violet-100 rounded-lg p-2.5">
            {indicators.map((item) => (
              <li key={item.code} className="flex gap-1.5 text-[11px] text-violet-900">
                <span className="font-mono font-bold text-violet-600 flex-shrink-0">{item.code}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Guardrail 2, restated at the decision point. The agent is about to
            put their name to this, so the distinction has to be in front of
            them here and not only on the card they may have scrolled past. */}
        <p className="text-[11px] text-slate-500 leading-relaxed">
          These are indicators for review, not findings of fraud. You may approve this claim.
          Your note is kept on file alongside the decision.
        </p>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Note for the file: why you are approving despite the advisory *
          </label>
          <textarea
            rows="4"
            placeholder="E.g., Verified the prior rear bumper repair was completed and inspected the current photographs — this is fresh damage from a separate documented incident."
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-violet-500 outline-none"
          ></textarea>
        </div>

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
            Review indicators
          </button>
          <button
            onClick={onConfirm}
            className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
          >
            Acknowledge and approve
          </button>
        </div>
      </div>
    </div>
  );
}
