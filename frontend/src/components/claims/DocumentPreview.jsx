/**
 * Inline preview of a single submitted document, rendered directly beneath the
 * requirement it satisfies. Renders one of four branches based on doc.type
 * (pdf_document / image_card / estimate / uploaded_file), followed by the OCR
 * fields that were extracted from this specific document.
 */

// documentpreview.jsx
export default function DocumentPreview({ doc, ocrData, onView, onZoomImage, onEditOcr }) {
  const docOcrFields = (ocrData || []).filter(field => field.sourceDoc === doc.id);

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">
            Submitted Document
          </div>
          <div className="text-[11px] text-blue-700 font-semibold truncate" title={doc.fileName || doc.title}>
            📄 {doc.fileName || doc.title}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onView(doc.id);
          }}
          className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2 py-1 rounded font-bold flex-shrink-0"
        >
          View
        </button>
      </div>

      {doc.type === 'pdf_document' && (
        <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-100 h-64">
          <object
            data={doc.fileUrl}
            type="application/pdf"
            className="w-full h-full"
          >
            <div className="h-full flex flex-col items-center justify-center gap-2 bg-white p-4 text-center">
              <span className="text-2xl">📄</span>
              <p className="text-[10px] font-bold text-slate-700">
                PDF preview is unavailable in this browser.
              </p>
              <a
                href={doc.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-[10px] font-bold"
              >
                Open PDF
              </a>
            </div>
          </object>
        </div>
      )}

      {(doc.type === 'image_card' || doc.type === 'uploaded_image') && (
        <div
          className="border border-slate-300 rounded-lg overflow-hidden bg-slate-100 cursor-pointer"
          onClick={() => onZoomImage({
            url: doc.imageUrl || doc.fileUrl,
            label: doc.imageLabel || doc.fileName || doc.title,
            caption: doc.caption || ''
          })}
        >
          <img
            src={doc.imageUrl || doc.fileUrl}
            alt={doc.imageLabel || doc.fileName || doc.title}
            className="w-full max-h-72 object-contain bg-slate-100"
          />
          <div className="px-2 py-1.5 text-[9px] text-slate-500 bg-white border-t border-slate-200 text-center">
            🔍 Click to zoom
          </div>
        </div>
      )}

      {doc.type === 'estimate' && (
        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-[10px] font-bold text-slate-700">
            Itemized Repair Estimate
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[9px]">
              <thead className="bg-slate-100 text-slate-500">
                <tr>
                  <th className="text-left px-2 py-1.5">Item</th>
                  <th className="text-right px-2 py-1.5">Cost</th>
                  <th className="text-center px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(doc.items || []).map((item, itemIdx) => (
                  <tr key={itemIdx}>
                    <td className="px-2 py-1.5">{item.item}</td>
                    <td className="px-2 py-1.5 text-right font-bold">₱{(item.cost || 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center">
                      {item.excluded
                        ? <span className="text-red-600 font-bold">Excluded</span>
                        : <span className="text-emerald-600 font-bold">Included</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {doc.type === 'uploaded_file' && (
        <div className="p-4 text-center bg-slate-50 rounded-lg border border-slate-200">
          <span className="text-2xl">📎</span>
          <p className="font-bold text-slate-800 text-[10px] mt-1">
            {doc.fileName || doc.title}
          </p>
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded text-[10px]"
          >
            Open File
          </a>
        </div>
      )}

      {/* OCR EDITOR FOR THIS DOCUMENT */}
      <div className="mt-3 pt-3 border-t border-slate-200">
        <div className="mb-2">
          <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">AI OCR Extraction</div>
          <div className="text-[9px] text-slate-500">Review and correct AI-extracted values from this document.</div>
        </div>
        {docOcrFields.length > 0 ? (
          <div className="space-y-1.5">
            {docOcrFields.map((ocrItem) => (
              <div key={ocrItem.fieldId} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-slate-700 truncate">{ocrItem.label}</div>
                  <div className="text-[10px] font-mono text-slate-600 truncate">AI: {ocrItem.extractedValue}</div>
                  {ocrItem.correctedValue && (
                    <div className="text-[10px] font-mono text-emerald-700 truncate">✓ Verified: {ocrItem.correctedValue}</div>
                  )}
                  <div className="text-[9px] text-slate-400">Confidence: {ocrItem.confidence || 'Not provided'}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditOcr(ocrItem);
                  }}
                  className="flex-shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded"
                >
                  ✏️ Edit OCR
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-2">No OCR fields are currently associated with this document.</div>
        )}
      </div>
    </div>
  );
}
