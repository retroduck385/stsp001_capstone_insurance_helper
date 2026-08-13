// components/claims/ClaimRequirements.jsx
import { claimRequirements, findDocumentForRequirement } from '../../data/claimRequirements';
import DocumentPreview from './DocumentPreview';

/**
 * Left panel of the claim workspace.
 */
export default function ClaimRequirements({
  activeClaim,
  isAnalyzing,
  fileInputRef,
  onFileSelected,
  onUploadClick,
  onDeleteDocument,
  isChecklistChecked,
  onToggleRequirement,
  onViewDocument,
  onZoomImage,
  onEditOcr,
  onOpenFormEditor,
  onOpenLicenseEditor
}) {
  const requirements = claimRequirements[activeClaim.claimType] || [];
  // One lookup per requirement, done once. `documentMatchesRequirement` used to
  // be called separately for "is it supplied?" and "which document is it?",
  // which could disagree; a single source avoids that entirely.
  const documentByRequirement = Object.fromEntries(
    requirements.map(req => [req, findDocumentForRequirement(req, activeClaim.documents)])
  );
  const confirmedCount = requirements.filter(req => isChecklistChecked(req)).length;
  const allConfirmed = confirmedCount === requirements.length && requirements.length > 0;

  return (
    <section className="w-1/2 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
      <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-300">📋 Claim Requirements & Submitted Documents</span>
        </div>
        <div className="flex items-center space-x-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onFileSelected}
            accept=".pdf,image/*,.doc,.docx,.jpg,.jpeg,.png"
          />
          {isAnalyzing && (
            <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300 px-2 py-1 rounded font-bold">
              ⚙️ AI Analyzing...
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-4 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Claim Requirements & Coverage</h2>
          <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold border border-blue-100">Source-Based Workflow</span>
        </div>

        {/* NEW: Claim Type / Policy Coverage cards, pulled straight from the claim doc */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Claim Type</span>
              <span className="text-sm font-bold text-blue-900 block mt-0.5">
                {activeClaim.claimType || '—'}
              </span>
            </div>
          </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <div>
              <span className="text-xs font-bold text-slate-700 block">Required Documents Checklist</span>
              <span className="text-[10px] text-slate-500">Requirements are defined by the claim type. Upload directly from the requirement so the document type is assigned automatically; use Replace when an updated file is received.</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded border ${allConfirmed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              {confirmedCount}/{requirements.length} Confirmed
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {requirements.map((req, idx) => {
              const matchedDoc = documentByRequirement[req];
              const supplied = Boolean(matchedDoc);
              const checked = isChecklistChecked(req);

              const isConditional =
                req.toLowerCase().includes('(if ') ||
                req.toLowerCase().includes('(death claim only)');

              // The licence editor belongs to the "Driver's License" row only —
              // NOT to "Official Receipt (Driver License / Vehicle OR ...)",
              // whose label also contains the words "driver license".
              const reqText = (req || '').toLowerCase();
              const isLicenseRequirement = reqText === "driver's license";
              const showEditLicense =
                matchedDoc && isLicenseRequirement && typeof onOpenLicenseEditor === 'function';

              return (
                <div
                  key={idx}
                  className={`rounded border text-[11px] transition overflow-hidden ${
                    checked
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : supplied
                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  {/* REQUIREMENT HEADER */}
                  <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <label className="flex items-start gap-2 min-w-0 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => onToggleRequirement(req, e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-emerald-600 flex-shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="font-semibold block">{req}</span>
                        {isConditional && (
                          <span className="text-[9px] opacity-70 block mt-0.5">Conditional requirement</span>
                        )}
                      </span>
                    </label>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="font-bold whitespace-nowrap">
                        {checked ? '✓ Confirmed' : supplied ? '📄 File detected' : '⚠ Not uploaded'}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUploadClick(matchedDoc?.id || null, req);
                        }}
                        className={`text-[10px] px-2 py-1 rounded font-bold transition ${
                          matchedDoc
                            ? 'bg-blue-600 hover:bg-blue-500 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                        title={matchedDoc ? 'Replace this document' : 'Upload this required document'}
                      >
                        {matchedDoc ? '↻ Replace' : '＋ Upload'}
                      </button>

                      {/* Remove — the only way to un-file a document without
                          editing MongoDB by hand. Unlike Replace, this also
                          clears the extracted fields, so a fresh upload gets a
                          clean AI re-read. */}
                      {matchedDoc && typeof onDeleteDocument === 'function' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteDocument(matchedDoc.id, req);
                          }}
                          className="text-[10px] px-2 py-1 rounded font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition"
                          title="Remove this document and clear its extracted fields"
                        >
                          🗑 Remove
                        </button>
                      )}

                      {/* Edit Form */}
                      {matchedDoc && (req || '').toLowerCase().includes('motor claim form') && typeof onOpenFormEditor === 'function' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFormEditor(matchedDoc.id, req);
                          }}
                          className="ml-2 text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded font-bold"
                          title="Edit parsed form fields"
                        >
                          Edit Form
                        </button>
                      )}

                      {/* Edit Driver's License (only shown for license requirement, not receipt rows) */}
                      {showEditLicense && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenLicenseEditor(matchedDoc.id, req);
                          }}
                          className="ml-2 text-[10px] bg-violet-600 hover:bg-violet-500 text-white px-2 py-1 rounded font-bold"
                          title="Edit Driver's License fields"
                        >
                          Edit License
                        </button>
                      )}
                    </div>
                  </div>

                  {/* DOCUMENT PREVIEW DIRECTLY UNDER THIS REQUIREMENT */}
                  {matchedDoc && (
                    <DocumentPreview
                      doc={matchedDoc}
                      ocrData={activeClaim.ocrData}
                      onView={onViewDocument}
                      onZoomImage={onZoomImage}
                      onEditOcr={onEditOcr}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2 p-2 bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-500">
            <strong>Workflow:</strong> Upload or Replace from a requirement automatically associates the file with that document type and triggers AI re-analysis. Checking a box records the adjuster’s confirmation.
          </div>
        </div>
      </div>
    </section>
  );
}