/**
 * HITL (human-in-the-loop) OCR field inspector.
 * Lists every AI-extracted field on the claim; clicking one scrolls the matching
 * document into view, and "Correct OCR" opens the correction modal.
 * Renders nothing when the claim has no OCR data.
 */
// ocrverification.jsx
export default function OcrVerification({ ocrData, activeOcrFieldId, onSelectField, onEditOcr }) {
  if (!ocrData || ocrData.length === 0) return null;

  return (
    <div className="bg-slate-900 text-white rounded-xl shadow-md p-4 space-y-3 font-sans text-xs border border-slate-800">
      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
        <div className="flex items-center space-x-2">
          <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">⚡ HITL Verification</span>
          <h3 className="font-bold text-slate-100 text-xs">Click field to locate in document canvas</h3>
        </div>
      </div>

      <div className="space-y-2">
        {ocrData.map((ocrItem) => {
          const isSelected = ocrItem.fieldId === activeOcrFieldId;
          return (
            <div
              key={ocrItem.fieldId}
              onClick={() => onSelectField(ocrItem)}
              className={`p-3 rounded-lg border transition cursor-pointer flex justify-between items-center ${
                isSelected ? 'bg-blue-950/90 border-blue-400 ring-1 ring-blue-400 shadow-md' : 'bg-slate-800/80 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="space-y-1 pr-2">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-400 font-semibold">{ocrItem.label}:</span>
                  <span className={`font-bold ${ocrItem.correctedValue ? 'text-emerald-400 line-through opacity-70' : 'text-white'}`}>
                    "{ocrItem.extractedValue}"
                  </span>
                  {ocrItem.correctedValue && (
                    <span className="font-bold text-emerald-300 text-sm">
                      → "{ocrItem.correctedValue}"
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-[10px]">
                  {ocrItem.correctedValue ? (
                    <span className="bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/40 font-bold">
                      ✏️ Corrected & Rules Re-evaluated
                    </span>
                  ) : ocrItem.isLowConfidence ? (
                    <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-300/40 font-bold">
                      ⚠️ Low Confidence ({ocrItem.confidence})
                    </span>
                  ) : (
                    <span className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/40">
                      ✓ Confidence: {ocrItem.confidence}
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-300 italic">
                  {ocrItem.issueNote}
                </p>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditOcr(ocrItem);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded transition flex-shrink-0 shadow"
              >
                {ocrItem.correctedValue ? '✏️ Edit Value' : '✏️ Correct OCR'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
