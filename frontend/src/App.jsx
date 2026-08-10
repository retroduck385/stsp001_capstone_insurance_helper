import { useState, useRef, useEffect } from 'react';
import { claimRequirements } from './claimRequirements'; //

export default function App () {
    // 1. INITIAL DATABASE STATES (Empty & Waiting)
    const [claimsDb, setClaimsDb] = useState({}); // Starts empty
    const [isLoading, setIsLoading] = useState(true); // Wait for database
    const [error, setError] = useState(null); //

    // 2. UI NAVIGATION STATES
    const [currentScreen, setCurrentScreen] = useState('dashboard'); //
    const [selectedClaimId, setSelectedClaimId] = useState(null); // Starts blank, dynamically filled below
    const [activeTab, setActiveTab] = useState('All Open'); //

    // 3. THE NETWORK BRIDGE (Connects to Server.js)
    useEffect(() => {
        const loadClaims = async () => {
            try {
                // Reach out to your Node.js server
                const response = await fetch('http://localhost:5001/api/claims'); //
                if (!response.ok) throw new Error('Failed to fetch claims from server'); //
                
                const data = await response.json(); //

                // Convert the flat MongoDB array into your UI's expected object format
                const formattedData = {}; //
                data.forEach(claim => { //
                    formattedData[claim.id] = claim; //
                });

                // Update the app memory
                setClaimsDb(formattedData); //
                
                // Dynamically select the very first claim from the database
                if (data.length > 0) { //
                    setSelectedClaimId(data[0].id); //
                }
                
                setIsLoading(false); // Turn off the loading screen
            } catch (err) {
                console.error(err); //
                setError(err.message); //
                setIsLoading(false); //
            }
        };

        loadClaims(); //
    }, []); // Empty array ensures this only runs once on load

    // 4. SAFETY GUARDS (Prevents crashes while data is downloading)
    // Because fetching data from a real database takes a split second, the if (isLoading) line ensures your dashboard doesn't try to render before the data has arrived.
    if (isLoading) return <div className="p-10 text-center font-bold text-slate-500">Loading InsureCopilot Dashboard...</div>; //
    if (error) return <div className="p-10 text-center font-bold text-red-500">Error: {error}</div>; //

    // 5. DYNAMIC CLAIM SELECTION
    // Fallback ensures it grabs the first claim found to prevent crashing
    const activeClaim = claimsDb[selectedClaimId] || Object.values(claimsDb)[0]; //
    
    // 6. EXISTING UI INTERACTIVE STATES
    const [approvedPayout, setApprovedPayout] = useState(activeClaim?.recommendedPayout || 0); //
    const [activeOcrFieldId, setActiveOcrFieldId] = useState('driver_name'); //
    const [activeDocId, setActiveDocId] = useState('doc-2'); //
    const [isModalOpen, setIsModalOpen] = useState(false); //
    const [isDenyModalOpen, setIsDenyModalOpen] = useState(false); //
    const [isEmailModalOpen, setIsEmailModalOpen] = useState(false); //
    const [editingOcrField, setEditingOcrField] = useState(null); //
    const [ocrCorrectionValue, setOcrCorrectionValue] = useState(''); //
    const [ocrCorrectionNote, setOcrCorrectionNote] = useState(''); //
    const [zoomedImage, setZoomedImage] = useState(null); //
    const [overrideReason, setOverrideReason] = useState(''); //
    const [denialReason, setDenialReason] = useState(''); //
    const [isModified, setIsModified] = useState(false); //
    const [emailSent, setEmailSent] = useState(false); //
    
    const [activityLogs, setActivityLogs] = useState([]); // Set to empty array for a clean slate
    const [isAnalyzing, setIsAnalyzing] = useState(false); //
    const [replaceDocId, setReplaceDocId] = useState(null); //
    const [uploadDocumentType, setUploadDocumentType] = useState(''); //
    const fileInputRef = useRef(null); //

     return (
        <div className="h-full flex flex-col">
          {/* TOP NAVIGATION BAR */}
          <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-md flex-shrink-0">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-blue-400">InsureCopilot</span>
                <span className="text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded border border-blue-700 font-mono">ADJUSTER WORKSPACE</span>
              </div>
              {currentScreen === 'detail' && (
                <>
                  <span className="text-slate-600">|</span>
                  <div className="text-sm"><span className="text-slate-400">Claim ID:</span> <span className="font-semibold text-white">{activeClaim.id}</span></div>
                  <div className="text-sm"><span className="text-slate-400">Insured:</span> <span className="font-semibold text-white">{activeClaim.policyholder}</span></div>
                </>
              )}
            </div>

            <div className="flex items-center space-x-4">
              {currentScreen === 'detail' ? (
                <>
                  <button onClick={() => setCurrentScreen('dashboard')} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-700 transition">
                    ← Back to Dashboard
                  </button>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                    activeClaim.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                    activeClaim.status === 'Denied' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                    'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}>
                    {activeClaim.status}
                  </span>
                </>
              ) : (
                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-white">Ethan Jackson</div>
                    <div className="text-xs text-slate-400">Claims Adjuster</div>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center border-2 border-blue-400">EJ</div>
                </div>
              )}
            </div>
          </header>

          {/* DASHBOARD SCREEN */}
          {currentScreen === 'dashboard' && (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">All Open Workload</span>
                    <span className="text-2xl font-extrabold text-blue-600">4 Claims</span>
                    <span className="text-xs text-blue-600 font-medium block mt-1">Pending active review</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Flagged / Exceptions</span>
                    <span className="text-2xl font-extrabold text-amber-600">3 Claims</span>
                    <span className="text-xs text-amber-600 font-medium block mt-1">Requires manual investigation</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Clean / Straight-Through</span>
                    <span className="text-2xl font-extrabold text-emerald-600">1 Claim</span>
                    <span className="text-xs text-emerald-600 font-medium block mt-1">Ready for 1-click approval</span>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
                  <div className="border-b border-slate-200 bg-slate-50/50 px-4 pt-3 flex space-x-2">
                    {[
                      { id: 'All Open', label: 'All Open' },
                      { id: 'Flagged / Exceptions', label: '⚠️ Flagged / Exceptions' },
                      { id: 'Clean / Straight-Through', label: '⚡ Clean / Straight-Through' },
                      { id: 'Completed', label: '✓ Processed & Completed' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2.5 text-xs font-bold rounded-t-lg transition border-b-2 ${
                          activeTab === tab.id ? 'bg-white text-blue-700 border-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800 border-transparent'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-semibold uppercase">
                          <th className="py-3 px-4">Claim ID & Policyholder</th>
                          <th className="py-3 px-4">Vehicle</th>
                          <th className="py-3 px-4">Claimed Amount</th>
                          <th className="py-3 px-4">Flags & Summary</th>
                          <th className="py-3 px-4 text-center">Docs</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredClaims.map((claim) => (
                          <tr key={claim.id} className="hover:bg-blue-50/40 transition cursor-pointer" onClick={() => openClaimDetail(claim.id)}>
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-blue-700">{claim.id}</div>
                              <div className="text-xs text-slate-500">{claim.policyholder}</div>
                            </td>
                            <td className="py-3.5 px-4 text-xs">{claim.vehicle}</td>
                            <td className="py-3.5 px-4 font-semibold text-xs">₱{claim.claimedAmount.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-xs font-bold">{claim.flagSummary}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center space-x-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                                📄 {claim.docsCount}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded transition shadow-sm">
                                Open Workspace →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDEBAR WITH DYNAMIC ACTIVITY ALERTS */}
              <aside className="w-80 bg-white border-l border-slate-200 p-4 flex flex-col space-y-4 flex-shrink-0">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2">
                    <span>🔔 Activity & Real-Time Alerts</span>
                  </h3>
                  <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">{activityLogs.length} New</span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {activityLogs.map(log => (
                    <div key={log.id} className={`p-3 rounded-lg text-xs space-y-1 shadow-sm border ${
                      log.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
                      log.type === 'danger' ? 'bg-red-50 border-red-200 text-red-900' :
                      log.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'
                    }`}>
                      <div className="flex justify-between font-bold">
                        <span>{log.type === 'success' ? '⚡ AI Re-evaluated' : log.type === 'danger' ? '🚫 Exception Flagged' : '⚠️ System Alert'}</span>
                        <span className="text-slate-400 font-normal">{log.time}</span>
                      </div>
                      <p className="opacity-90">{log.text}</p>
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-500 border border-slate-200">
                  👤 <strong>Adjuster:</strong> Ethan Jackson (Senior Claims)
                </div>
              </aside>
            </div>
          )}

          {/* DETAILED WORKSPACE (SIDE-BY-SIDE FAST HITL MODE) */}
          {currentScreen === 'detail' && (
            <main className="flex-1 flex overflow-hidden p-4 gap-4">
              
              {/* LEFT PANEL: CLAIM REQUIREMENTS WITH INLINE DOCUMENT PREVIEWS */}
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
                      onChange={handleDocumentUpload}
                      accept=".pdf,image/*,.doc,.docx,.jpg,.jpeg,.png"
                    />
                    {isAnalyzing && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300 px-2 py-1 rounded font-bold">
                        ⚙️ AI Analyzing...
                      </span>
                    )}
                  </div>
                </div>

                {/* CLAIM TYPE / COVERAGE / DOCUMENT REQUIREMENTS */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-4 flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Claim Requirements & Coverage</h2>
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold border border-blue-100">Source-Based Workflow</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <span className="text-[10px] text-blue-600 font-bold uppercase block">Claim Type</span>
                      <span className="text-sm font-extrabold text-blue-900">{activeClaim.claimType || 'Not yet classified'}</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block">Policy Coverage</span>
                      <span className="text-sm font-extrabold text-slate-800">{activeClaim.status === 'Denied' ? 'Coverage requires review' : 'Applicable coverage requires policy verification'}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <span className="text-xs font-bold text-slate-700 block">Required Documents Checklist</span>
                        <span className="text-[10px] text-slate-500">Requirements are defined by the claim type. Upload directly from the requirement so the document type is assigned automatically; use Replace when an updated file is received.</span>
                      </div>
                      {(() => {
                        const reqs = claimRequirements[activeClaim.claimType] || [];
                        const checked = reqs.filter(r => isChecklistChecked(r)).length;
                        return (
                          <span className={`text-[10px] font-bold px-2 py-1 rounded border ${checked === reqs.length && reqs.length > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                            {checked}/{reqs.length} Confirmed
                          </span>
                        );
                      })()}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {(claimRequirements[activeClaim.claimType] || []).map((req, idx) => {
                        const supplied = documentMatchesRequirement(req, activeClaim.documents);
                        const checked = isChecklistChecked(req);
                        const isConditional = req.toLowerCase().includes('(if ') || req.toLowerCase().includes('(death claim only)');
                        const matchedDoc = (activeClaim.documents || []).find(doc => documentMatchesRequirement(req, [doc]));

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
                                  onChange={(e) => handleChecklistToggle(req, e.target.checked)}
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
                                    triggerFilePicker(matchedDoc?.id || null, req);
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
                              </div>
                            </div>

                            {/* DOCUMENT PREVIEW DIRECTLY UNDER THIS REQUIREMENT */}
                            {matchedDoc && (
                              <div className="border-t border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">
                                      Submitted Document
                                    </div>
                                    <div className="text-[11px] text-blue-700 font-semibold truncate" title={matchedDoc.fileName || matchedDoc.title}>
                                      📄 {matchedDoc.fileName || matchedDoc.title}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveDocId(matchedDoc.id);
                                    }}
                                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2 py-1 rounded font-bold flex-shrink-0"
                                  >
                                    View
                                  </button>
                                </div>

                                {matchedDoc.type === 'pdf_document' && (
                                  <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-100 h-64">
                                    <object
                                      data={matchedDoc.fileUrl}
                                      type="application/pdf"
                                      className="w-full h-full"
                                    >
                                      <div className="h-full flex flex-col items-center justify-center gap-2 bg-white p-4 text-center">
                                        <span className="text-2xl">📄</span>
                                        <p className="text-[10px] font-bold text-slate-700">
                                          PDF preview is unavailable in this browser.
                                        </p>
                                        <a
                                          href={matchedDoc.fileUrl}
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

                                {(matchedDoc.type === 'image_card' || matchedDoc.type === 'uploaded_image') && (
                                  <div
                                    className="border border-slate-300 rounded-lg overflow-hidden bg-slate-100 cursor-pointer"
                                    onClick={() => setZoomedImage({
                                      url: matchedDoc.imageUrl || matchedDoc.fileUrl,
                                      label: matchedDoc.imageLabel || matchedDoc.fileName || matchedDoc.title,
                                      caption: matchedDoc.caption || ''
                                    })}
                                  >
                                    <img
                                      src={matchedDoc.imageUrl || matchedDoc.fileUrl}
                                      alt={matchedDoc.imageLabel || matchedDoc.fileName || matchedDoc.title}
                                      className="w-full max-h-72 object-contain bg-slate-100"
                                    />
                                    <div className="px-2 py-1.5 text-[9px] text-slate-500 bg-white border-t border-slate-200 text-center">
                                      🔍 Click to zoom
                                    </div>
                                  </div>
                                )}

                                {matchedDoc.type === 'estimate' && (
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
                                          {(matchedDoc.items || []).map((item, itemIdx) => (
                                            <tr key={itemIdx}>
                                              <td className="px-2 py-1.5">{item.item}</td>
                                              <td className="px-2 py-1.5 text-right font-bold">₱{item.cost.toLocaleString()}</td>
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

                                {matchedDoc.type === 'uploaded_file' && (
                                  <div className="p-4 text-center bg-slate-50 rounded-lg border border-slate-200">
                                    <span className="text-2xl">📎</span>
                                    <p className="font-bold text-slate-800 text-[10px] mt-1">
                                      {matchedDoc.fileName || matchedDoc.title}
                                    </p>
                                    <a
                                      href={matchedDoc.fileUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-block mt-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded text-[10px]"
                                    >
                                      Open File
                                    </a>
                                  </div>
                                )}

                                {/* OCR EDITOR FOR THIS DOCUMENT */}
                                {(() => {
                                  const docOcrFields = (activeClaim.ocrData || []).filter(field => field.sourceDoc === matchedDoc.id);
                                  return (
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
                                                  openOcrModal(ocrItem);
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
                                  );
                                })()}
                              </div>
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

              {/* RIGHT PANEL: COPILOT ASSESSMENT & FAST HITL OCR VERIFICATION (50%) */}
              <section className="w-1/2 flex flex-col space-y-4 overflow-y-auto pr-1">
                
                {/* HITL DATA FIELD INSPECTOR & QUICK FIELD SELECTOR */}
                {activeClaim.ocrData && activeClaim.ocrData.length > 0 && (
                  <div className="bg-slate-900 text-white rounded-xl shadow-md p-4 space-y-3 font-sans text-xs border border-slate-800">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">⚡ HITL Verification</span>
                        <h3 className="font-bold text-slate-100 text-xs">Click field to locate in document canvas</h3>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {activeClaim.ocrData.map((ocrItem) => {
                        const isSelected = ocrItem.fieldId === activeOcrFieldId;
                        return (
                          <div 
                            key={ocrItem.fieldId} 
                            onClick={() => handleSelectField(ocrItem)}
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
                                openOcrModal(ocrItem);
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
                )}

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
                      <span className="text-lg font-bold text-slate-900">₱{activeClaim.claimedAmount.toLocaleString()}</span>
                    </div>
                    <div className={`p-3 rounded-lg border ${activeClaim.status === 'Denied' ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
                      <span className={`text-xs block ${activeClaim.status === 'Denied' ? 'text-red-600' : 'text-blue-600'}`}>
                        Approved Payout
                      </span>
                      <span className={`text-lg font-bold ${activeClaim.status === 'Denied' ? 'text-red-700' : 'text-blue-700'}`}>
                        ₱{activeClaim.status === 'Denied' ? '0' : approvedPayout.toLocaleString()}
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

                  {activeClaim.status === 'Denied' && denialReason && (
                    <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
                      <strong>Reason for Claim Rejection:</strong> "{denialReason}"
                    </div>
                  )}
                </div>

                {/* DYNAMIC POLICY RULES ENGINE DISPLAY */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Automated Policy Rules & Flags</h2>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">Dynamic Evaluation Active</span>
                  </div>
                  {activeClaim.rules.map((rule, idx) => (
                    <div key={idx} className={`flex items-start space-x-3 p-3 rounded-lg border ${
                      rule.type === 'green' ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900' :
                      rule.type === 'yellow' ? 'bg-amber-50/60 border-amber-200 text-amber-900' : 'bg-red-50/60 border-red-200 text-red-900'
                    }`}>
                      <span className="text-base">{rule.type === 'green' ? '🟢' : rule.type === 'yellow' ? '🟡' : '🔴'}</span>
                      <div>
                        <h4 className="text-xs font-bold">{rule.title}</h4>
                        <p className="text-xs opacity-90">{rule.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-900 text-slate-300 rounded-xl p-4 shadow-sm space-y-2">
                  <span className="text-xs font-bold text-blue-400 block border-b border-slate-800 pb-1">📌 Master Policy Contract Citation</span>
                  <p className="text-xs italic leading-relaxed">"{activeClaim.citation}"</p>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-slate-400 block">Final Decision Payout</span>
                      <span className={`text-xl font-extrabold ${activeClaim.status === 'Denied' ? 'text-red-600' : 'text-slate-900'}`}>
                        ₱{activeClaim.status === 'Denied' ? '0' : approvedPayout.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex space-x-2">
                      {activeClaim.status === 'In Assessment' ? (
                        <>
                          <button 
                            onClick={handleDirectApprove}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3.5 py-2.5 rounded-lg transition shadow-sm flex items-center space-x-1"
                          >
                            <span>⚡ Approve</span>
                          </button>
                          <button 
                            onClick={() => setIsModalOpen(true)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-lg border border-slate-300 transition"
                          >
                            ✏️ Edit Payout
                          </button>
                          <button 
                            onClick={() => setIsDenyModalOpen(true)}
                            className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-2.5 rounded-lg transition shadow-sm"
                          >
                            🚫 Deny Claim
                          </button>
                        </>
                      ) : activeClaim.status === 'Denied' ? (
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

                  {(activeClaim.status === 'Completed' || activeClaim.status === 'Denied') && (
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                      <div>
                        <div className="text-xs font-bold text-slate-800">Policyholder Notification</div>
                        <div className="text-[11px] text-slate-500">
                          {emailSent ? '✓ Email dispatch confirmed.' : `Send decision notice to ${activeClaim.email}`}
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsEmailModalOpen(true)}
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

              </section>
            </main>
          )}

          {/* FULL-SCREEN IMAGE ZOOM / LIGHTBOX MODAL */}
          {zoomedImage && (
            <div 
              className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex flex-col justify-between p-6 z-50"
              onClick={() => setZoomedImage(null)}
            >
              <div className="flex justify-between items-center text-white z-10" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center space-x-2">
                  <span className="bg-blue-600 text-xs font-bold px-2 py-1 rounded">IMAGE INSPECTOR</span>
                  <h3 className="text-sm font-bold text-slate-200">{zoomedImage.label}</h3>
                </div>
                <button 
                  onClick={() => setZoomedImage(null)} 
                  className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-1.5 rounded-lg border border-slate-700 text-xs transition"
                >
                  ✕ Close Viewer (ESC)
                </button>
              </div>

              <div className="flex-1 flex items-center justify-center p-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <img 
                  src={zoomedImage.url} 
                  alt={zoomedImage.label} 
                  className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl border border-slate-700"
                />
              </div>

              <div className="bg-slate-900/90 text-slate-200 p-3 rounded-lg border border-slate-800 text-xs max-w-2xl mx-auto text-center" onClick={(e) => e.stopPropagation()}>
                <strong>Details:</strong> {zoomedImage.caption}
              </div>
            </div>
          )}

          {/* EDIT OCR DATA CORRECTION MODAL WITH RE-ANALYSIS TRIGGER */}
          {editingOcrField && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-blue-100">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <h3 className="text-base font-bold text-slate-900 flex items-center space-x-1">
                    <span>✏️ Correct AI OCR Field & Re-Analyze</span>
                  </h3>
                  <button onClick={() => setEditingOcrField(null)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
                </div>
                
                <p className="text-xs text-slate-500">
                  Overriding OCR extraction for: <strong>{editingOcrField.label}</strong>. Saving will automatically re-trigger AI rule evaluation.
                </p>
                
                <div className="space-y-3">
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs">
                    <span className="text-slate-500 block">Original Raw OCR Text:</span>
                    <span className="font-mono font-bold text-slate-800">{editingOcrField.extractedValue}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Human Verified Correct Value *</label>
                    <input 
                      type="text" 
                      value={ocrCorrectionValue} 
                      onChange={(e) => setOcrCorrectionValue(e.target.value)}
                      className="w-full border border-blue-400 rounded-lg p-2.5 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Adjuster Audit Note (Optional)</label>
                    <input 
                      type="text"
                      placeholder="E.g., Glare on driver license scan obscured character 'u'..."
                      value={ocrCorrectionNote}
                      onChange={(e) => setOcrCorrectionNote(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-800 outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button onClick={() => setEditingOcrField(null)} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
                    Cancel
                  </button>
                  <button 
                    onClick={handleSaveOcrCorrection}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm flex items-center space-x-1"
                  >
                    <span>⚡ Save & Re-Evaluate AI Analysis</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DENY CLAIM REASON MODAL */}
          {isDenyModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-red-100">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <h3 className="text-base font-bold text-red-700 flex items-center space-x-1">
                    <span>🚫 Reject / Deny Insurance Claim</span>
                  </h3>
                  <button onClick={() => setIsDenyModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
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
                    onChange={(e) => setDenialReason(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-red-500 outline-none"
                  ></textarea>
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button onClick={() => setIsDenyModalOpen(false)} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
                    Cancel
                  </button>
                  <button 
                    onClick={handleConfirmDenial}
                    className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
                  >
                    Confirm Claim Rejection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* EDIT PAYOUT & COMMENTS MODAL */}
          {isModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <h3 className="text-base font-bold text-slate-900">Modify Claim Payout & Add Comments</h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
                </div>
                
                <p className="text-xs text-slate-500">Enter your revised payout figure and explain your reasoning in the comments field below for regulatory compliance.</p>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Adjusted Approved Payout (PHP)</label>
                    <input 
                      type="number" 
                      value={approvedPayout} 
                      onChange={(e) => setApprovedPayout(Number(e.target.value))}
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Adjuster Comments & Reason for Modification *</label>
                    <textarea 
                      rows="3"
                      placeholder="Enter specific comments or reasons for overriding payout (e.g., Excluded battery per policy section II, goodwill consideration granted)..."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                    ></textarea>
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg hover:bg-slate-200">
                    Cancel
                  </button>
                  <button 
                    onClick={handleSaveAndApproveEdit}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
                  >
                    ✓ Save & Approve Modified Payout
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SEND EMAIL NOTIFICATION PREVIEW MODAL */}
          {isEmailModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <h3 className="text-base font-bold text-slate-900">📧 Policyholder Email Preview</h3>
                  <button onClick={() => setIsEmailModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">×</button>
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
                      <p><strong>Claim Status:</strong> {activeClaim.status === 'Denied' ? 'REJECTED / DENIED' : isModified ? 'APPROVED WITH ADJUSTMENTS' : 'APPROVED'}</p>
                      <p><strong>Claimed Amount:</strong> ₱{activeClaim.claimedAmount.toLocaleString()}</p>
                      <p><strong>Final Approved Payout:</strong> ₱{activeClaim.status === 'Denied' ? '0' : approvedPayout.toLocaleString()}</p>
                    </div>

                    {activeClaim.status === 'Denied' && denialReason && (
                      <p className="italic bg-red-50 p-2.5 rounded text-red-900 border border-red-200">
                        <strong>Reason for Rejection:</strong> "{denialReason}"
                      </p>
                    )}

                    {isModified && overrideReason && activeClaim.status !== 'Denied' && (
                      <p className="italic bg-amber-50 p-2.5 rounded text-amber-900 border border-amber-200">
                        <strong>Adjuster Note:</strong> "{overrideReason}"
                      </p>
                    )}

                    <p>
                      {activeClaim.status === 'Denied' 
                        ? 'If you have additional questions regarding this decision, please reach out to our claims office.'
                        : 'Payment disbursement will be processed shortly. Thank you for choosing InsureCopilot.'}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button onClick={() => setIsEmailModalOpen(false)} className="bg-slate-100 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg">
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      setEmailSent(true);
                      setIsEmailModalOpen(false);
                      alert(`Email successfully dispatched to ${activeClaim.email}!`);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-sm"
                  >
                    🚀 Confirm & Send Email
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
    );
}