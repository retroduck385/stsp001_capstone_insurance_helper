/**
 * OCR correction form.
 * `field` is null when closed, otherwise the OCR item being corrected.
 * Saving re-runs the rules engine in App.jsx's handleSaveOcrCorrection.
 */
export default function OcrCorrectionModal({
  field,
  correctionValue,
  onCorrectionValueChange,
  correctionNote,
  onCorrectionNoteChange,
  onClose,
  onSave
}) {
  if (!field) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-blue-100">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-1">
            <span>✏️ Correct AI OCR Field & Re-Analyze</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
        </div>

        <p className="text-xs text-slate-500">
          Overriding OCR extraction for: <strong>{field.label}</strong>. Saving will automatically re-trigger AI rule evaluation.
        </p>

        <div className="space-y-3">
          <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs">
            <span className="text-slate-500 block">Original Raw OCR Text:</span>
            <span className="font-mono font-bold text-slate-800">{field.extractedValue}</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Human Verified Correct Value *</label>
            <input
              type="text"
              value={correctionValue}
              onChange={(e) => onCorrectionValueChange(e.target.value)}
              className="w-full border border-blue-400 rounded-lg p-2.5 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Adjuster Audit Note (Optional)</label>
            <input
              type="text"
              placeholder="E.g., Glare on driver license scan obscured character 'u'..."
              value={correctionNote}
              onChange={(e) => onCorrectionNoteChange(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-800 outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={onSave}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm flex items-center space-x-1"
          >
            <span>⚡ Save & Re-Evaluate AI Analysis</span>
          </button>
        </div>
      </div>
    </div>
  );
}
