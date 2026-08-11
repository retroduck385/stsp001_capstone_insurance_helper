// app.jsx
import { useState, useRef, useEffect } from 'react';

import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import ClaimWorkspace from './components/ClaimWorkspace';
import ImageViewerModal from './components/modals/ImageViewerModal';
import OcrCorrectionModal from './components/modals/OcrCorrectionModal';
import DenyClaimModal from './components/modals/DenyClaimModal';
import EditPayoutModal from './components/modals/EditPayoutModal';
import EmailModal from './components/modals/EmailModal';
import { fetchClaims, uploadDocument, replaceDocument, saveOcrCorrections } from './services/api';
import { buildOcrPatch } from './services/ocrAdapter';

/**
 * Application root.
 *
 * This is the only stateful component in the app — every component under
 * components/ is presentational and receives what it needs through props.
 *
 * Responsibilities:
 *   1. Fetch the claims from the Node/Mongo API and key them by claim id.
 *   2. Hold all UI state (selected claim, tabs, modals, checklist, uploads).
 *   3. Own every handler that mutates that state.
 *   4. Switch between the Dashboard and the ClaimWorkspace screens.
 */
export default function App() {
  // ---------------------------------------------------------------------
  // 1. DATABASE STATE (populated from the API)
  // ---------------------------------------------------------------------
  const [claimsDb, setClaimsDb] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---------------------------------------------------------------------
  // 2. UI STATE
  // ---------------------------------------------------------------------
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [selectedClaimId, setSelectedClaimId] = useState(null);
  const [activeTab, setActiveTab] = useState('All Open');
  const [formEditorTarget, setFormEditorTarget] = useState({ docId: null, requirement: null });
  const [licenseEditorTarget, setLicenseEditorTarget] = useState({ docId: null, requirement: null });


  const [approvedPayout, setApprovedPayout] = useState(0);
  const [activeOcrFieldId, setActiveOcrFieldId] = useState(null);
  const [activeDocId, setActiveDocId] = useState(null);
  

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDenyModalOpen, setIsDenyModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [editingOcrField, setEditingOcrField] = useState(null);
  const [zoomedImage, setZoomedImage] = useState(null);

  // Form fields
  const [ocrCorrectionValue, setOcrCorrectionValue] = useState('');
  const [ocrCorrectionNote, setOcrCorrectionNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [isModified, setIsModified] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const [activityLogs, setActivityLogs] = useState([]);

  // Document upload / replacement
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [replaceDocId, setReplaceDocId] = useState(null);
  const [uploadDocumentType, setUploadDocumentType] = useState('');
  const fileInputRef = useRef(null);

  // Adjuster document checklist, stored separately from the uploaded files so
  // the adjuster can confirm each requirement after reviewing the file.
  // Keyed by `${claimId}::${requirement}`.
  const [checklistState, setChecklistState] = useState({});

  // ---------------------------------------------------------------------
  // 3. THE NETWORK BRIDGE (connects to backend/src/server.js)
  // ---------------------------------------------------------------------
  useEffect(() => {
    const loadClaims = async () => {
      try {
        // fetchClaims also rewrites each document's fileUrl/imageUrl from the
        // relative path the API stores ("/uploads/x.pdf") to an absolute one
        // pointing at the backend, so previews resolve.
        const data = await fetchClaims();

        // The API returns an array; the UI works with an id-keyed object.
        const formattedData = {};
        data.forEach(claim => {
          formattedData[claim.id] = claim;
        });
        setClaimsDb(formattedData);

        // Preselect the first claim so the workspace has something to show.
        if (data.length > 0) {
          setSelectedClaimId(data[0].id);
          setApprovedPayout(data[0].recommendedPayout || 0);
        }

        setIsLoading(false);
      } catch (err) {
        console.error(err);
        setError(err.message);
        setIsLoading(false);
      }
    };

    loadClaims();
  }, []);

  // ---------------------------------------------------------------------
  // 4. GUARDS — must stay below every hook above, or React throws
  //    "Rendered more hooks than during the previous render".
  // ---------------------------------------------------------------------
  const activeClaim = claimsDb[selectedClaimId] || Object.values(claimsDb)[0];

  if (isLoading) return <div className="p-10 text-center font-bold text-slate-500">Loading InsureCopilot Dashboard...</div>;
  if (error) return <div className="p-10 text-center font-bold text-red-500">Error: {error}</div>;
  if (!activeClaim) return <div className="p-10 text-center font-bold text-slate-500">No claims found in the database.</div>;

  // ---------------------------------------------------------------------
  // 5. DERIVED VALUES
  // ---------------------------------------------------------------------
  const filteredClaims = Object.values(claimsDb).filter(claim => {
    if (activeTab === 'All Open') return claim.status === 'In Assessment';
    if (activeTab === 'Flagged / Exceptions') return claim.status === 'In Assessment' && claim.isFlagged;
    if (activeTab === 'Clean / Straight-Through') return claim.status === 'In Assessment' && !claim.isFlagged;
    if (activeTab === 'Completed') return claim.status === 'Completed' || claim.status === 'Denied';
    return true;
  });

  // ---------------------------------------------------------------------
  // 6. HELPERS
  // ---------------------------------------------------------------------
  const scrollToDoc = (docId) => {
    const el = document.getElementById(docId);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const runAiAnalysis = (reason) => {
    setIsAnalyzing(true);
    setActivityLogs(prev => [
      { id: Date.now(), type: 'info', text: `AI analysis triggered: ${reason}. Documents and policy rules are being re-evaluated.`, time: 'Just now' },
      ...prev
    ]);
    setTimeout(() => {
      setIsAnalyzing(false);
      setActivityLogs(prev => [
        { id: Date.now() + 1, type: 'success', text: `AI analysis completed for ${selectedClaimId}. Adjuster review remains required.`, time: 'Just now' },
        ...prev
      ]);
    }, 650);
  };

  // ---------------------------------------------------------------------
  // 7. NAVIGATION HANDLERS
  // ---------------------------------------------------------------------
  const openClaimDetail = (id) => {
    setSelectedClaimId(id);
    const target = claimsDb[id];
    if (target) {
      setApprovedPayout(target.recommendedPayout || 0);
      setIsModified(false);
      setOverrideReason('');
      setDenialReason('');
      setEmailSent(false);
      if (target.ocrData && target.ocrData.length > 0) {
        setActiveOcrFieldId(target.ocrData[0].fieldId);
        setActiveDocId(target.ocrData[0].sourceDoc);
      }
    }
    setCurrentScreen('detail');
  };

  // ---------------------------------------------------------------------
  // 8. CHECKLIST HANDLERS
  // ---------------------------------------------------------------------
  const checklistKey = (claimId, requirement) => `${claimId}::${requirement}`;

  const isChecklistChecked = (requirement) =>
    !!checklistState[checklistKey(selectedClaimId, requirement)];

  const handleChecklistToggle = (requirement, checked) => {
    setChecklistState(prev => ({
      ...prev,
      [checklistKey(selectedClaimId, requirement)]: checked
    }));
  };

  const openFormEditor = (docId, requirement) => {
  console.log('openFormEditor called', { docId, requirement });
  // clear license editor when opening the motor form editor
  setLicenseEditorTarget({ docId: null, requirement: null });
  setFormEditorTarget({ docId, requirement });
};

  const closeFormEditor = () => setFormEditorTarget({ docId: null, requirement: null });

  /**
   * Saves adjuster edits to one ocrData section, to MongoDB.
   *
   * `edits` is a flat { fieldId: value } object as both editors emit.
   * buildOcrPatch converts it into the nested shape the backend stores, and
   * drops anything that hasn't actually changed.
   */
  const persistOcrEdits = async (edits, sectionKey, reason) => {
    const claimId = selectedClaimId;
    const patch = buildOcrPatch(edits, sectionKey, claimsDb[claimId]?.ocrDataRaw);

    if (Object.keys(patch).length === 0) {
      runAiAnalysis(`${reason} (no changes to save)`);
      return;
    }

    setIsAnalyzing(true);
    try {
      const updatedClaim = await saveOcrCorrections(claimId, patch);
      setClaimsDb(prev => ({ ...prev, [claimId]: updatedClaim }));
      runAiAnalysis(reason);
    } catch (err) {
      setIsAnalyzing(false);
      console.error(err);
      setActivityLogs(prev => [
        { id: Date.now(), type: 'danger', text: `Could not save edits: ${err.message}`, time: 'Just now' },
        ...prev
      ]);
      alert(`Could not save: ${err.message}`);
    }
  };

  // callback when DocumentFormEditor saves updated fields
  const handleSaveFormFields = async (updatedFields) => {
    // The editor emits the damage table as `damage_rows`, but the schema calls
    // it `description_of_damage`. Rename it on the way through.
    const { damage_rows, ...rest } = updatedFields || {};
    const edits = { ...rest };
    if (damage_rows !== undefined) edits.description_of_damage = damage_rows;

    closeFormEditor();
    await persistOcrEdits(edits, 'motorClaimForm', `Adjuster saved form edits on ${selectedClaimId}`);
 };

 const openLicenseEditor = (docId, requirement) => {
  console.log('openLicenseEditor called', { docId, requirement });
  // clear form editor when opening the license editor
  setFormEditorTarget({ docId: null, requirement: null });
  setLicenseEditorTarget({ docId, requirement });
};

const closeLicenseEditor = () => setLicenseEditorTarget({ docId: null, requirement: null });

const handleSaveLicenseFields = async (licensePayload) => {
  // licensePayload keys: driver_license_number, driver_license_class, ...
  // Two of them (driver_license_type, driver_license_issue_date) are commented
  // out in the Mongoose schema; buildOcrPatch drops them rather than sending
  // fields the backend would silently discard.
  closeLicenseEditor();
  await persistOcrEdits(licensePayload, 'driversLicense', `Adjuster saved license edits on ${selectedClaimId}`);
};

  // ---------------------------------------------------------------------
  // 9. DOCUMENT UPLOAD HANDLERS
  // ---------------------------------------------------------------------
  const triggerFilePicker = (docId = null, documentType = '') => {
    setReplaceDocId(docId);
    if (docId) {
      const existing = (claimsDb[selectedClaimId]?.documents || []).find(doc => doc.id === docId);
      setUploadDocumentType(existing?.documentType || documentType || '');
    } else {
      setUploadDocumentType(documentType || '');
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  /**
   * Sends the chosen file to the backend, which stores it on disk and appends
   * its metadata to the claim's `documents` array in MongoDB.
   *
   * The server's response — the full updated claim — replaces our local copy,
   * so what's on screen is always what's actually in the database. Nothing is
   * added to the UI optimistically: if the upload fails, no phantom document
   * appears.
   */
  const handleDocumentUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Capture these BEFORE any state setter runs. React state updates are
    // asynchronous, and there's an `await` below — reading replaceDocId after
    // clearing it would give us a stale value.
    const claimId = selectedClaimId;
    const targetDocId = replaceDocId;
    const isReplacing = Boolean(targetDocId);

    const existingDoc = targetDocId
      ? (claimsDb[claimId]?.documents || []).find(doc => doc.id === targetDocId)
      : null;
    const documentType = existingDoc?.documentType || uploadDocumentType || '';

    if (!documentType) {
      alert('This upload must be started from a specific claim requirement.');
      event.target.value = '';
      return;
    }

    setIsAnalyzing(true); // drives the "⚙️ AI Analyzing..." badge while in flight

    try {
      const updatedClaim = isReplacing
        ? await replaceDocument(claimId, targetDocId, file, documentType)
        : await uploadDocument(claimId, file, documentType);

      // The database is the source of truth — take the server's version wholesale.
      setClaimsDb(prev => ({ ...prev, [claimId]: updatedClaim }));

      // A replaced document keeps its id; a new one is appended to the end.
      const docs = updatedClaim.documents || [];
      const savedDoc = isReplacing ? docs.find(doc => doc.id === targetDocId) : docs[docs.length - 1];
      if (savedDoc) {
        setActiveDocId(savedDoc.id);
        setTimeout(() => scrollToDoc(savedDoc.id), 50);
      }

      // Leaves isAnalyzing on for its own 650ms window, then clears it.
      runAiAnalysis(isReplacing ? `document replaced with ${file.name}` : `document ${file.name} uploaded`);
    } catch (err) {
      setIsAnalyzing(false);
      console.error(err);
      setActivityLogs(prev => [
        {
          id: Date.now(),
          type: 'danger',
          text: `Upload of "${file.name}" failed: ${err.message}`,
          time: 'Just now'
        },
        ...prev
      ]);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setReplaceDocId(null);
      setUploadDocumentType('');
      event.target.value = ''; // let the same file be re-selected after a failure
    }
  };

  // ---------------------------------------------------------------------
  // 10. OCR HANDLERS
  // ---------------------------------------------------------------------
  const handleSelectField = (ocrItem) => {
    setActiveOcrFieldId(ocrItem.fieldId);
    if (ocrItem.sourceDoc) {
      setActiveDocId(ocrItem.sourceDoc);
      scrollToDoc(ocrItem.sourceDoc);
    }
  };

  const openOcrModal = (field) => {
    setEditingOcrField(field);
    setOcrCorrectionValue(field.correctedValue || field.extractedValue);
    setOcrCorrectionNote('');
  };

  const closeOcrModal = () => {
    setEditingOcrField(null);
    setOcrCorrectionValue('');
    setOcrCorrectionNote('');
  };

  // Saving an OCR correction persists it, then re-runs the (mock) rules engine.
  const handleSaveOcrCorrection = async () => {
    if (!ocrCorrectionValue.trim()) {
      alert('Please enter the corrected value.');
      return;
    }

    const claimId = selectedClaimId;
    const fieldId = editingOcrField.fieldId;
    const newValue = ocrCorrectionValue;
    const note = ocrCorrectionNote;
    setIsAnalyzing(true);

    // 1. Save the corrected value to MongoDB. `section` comes from the adapter
    //    and says which ocrData section this field belongs to.
    let persistedClaim;
    try {
      const patch = buildOcrPatch({ [fieldId]: newValue }, editingOcrField.section || null);
      if (Object.keys(patch).length === 0) {
        throw new Error(`"${fieldId}" is not a field the backend schema stores.`);
      }
      persistedClaim = await saveOcrCorrections(claimId, patch);
    } catch (err) {
      setIsAnalyzing(false);
      console.error(err);
      setActivityLogs(prev => [
        { id: Date.now(), type: 'danger', text: `Could not save OCR correction: ${err.message}`, time: 'Just now' },
        ...prev
      ]);
      alert(`Could not save: ${err.message}`);
      return;
    }

    // 2. Mark the field as adjuster-corrected in the on-screen list. The schema
    //    keeps only one value per field, so this distinction is session-only —
    //    see the note at the top of services/ocrAdapter.js.
    const updatedOcrList = (persistedClaim.ocrData || []).map(item => {
      if (item.fieldId === fieldId) {
        return {
          ...item,
          extractedValue: editingOcrField.extractedValue,
          correctedValue: newValue,
          isLowConfidence: false,
          issueNote: note ? `Adjuster Note: ${note}` : 'Adjuster verified & corrected field.'
        };
      }
      return item;
    });

    // 3. Re-evaluate the rules engine
    let updatedRules = [...(activeClaim.rules || [])];
    let updatedFlagSummary = activeClaim.flagSummary;
    const updatedIsFlagged = activeClaim.isFlagged;
    let newRecommendedPayout = activeClaim.recommendedPayout;

    // If a driver-name field was corrected, check whether it now matches the
    // policyholder. These are the real schema field ids for the driver's name —
    // one on the motor claim form, one on the licence itself.
    const DRIVER_NAME_FIELDS = ['driver_full_name', 'driver_license_name'];
    if (DRIVER_NAME_FIELDS.includes(fieldId) && activeClaim.policyholder) {
      if (newValue.toLowerCase().trim() === activeClaim.policyholder.toLowerCase().trim()) {
        updatedRules = updatedRules.filter(r => !r.title.includes('Unnamed Driver'));
        updatedRules.push({
          type: 'green',
          title: '✓ Driver Identity Verified (OCR Corrected)',
          text: `Adjuster corrected driver name to "${newValue}", matching policyholder record exactly.`
        });
        updatedFlagSummary = '🟢 Driver Identity Verified';
      }
    }

    // 4. Merge the rules re-evaluation onto the claim the server just returned.
    //    Note the rules/payout changes are LOCAL ONLY — there is no endpoint for
    //    them yet, so they are lost on refresh. Only the OCR value persists.
    setClaimsDb(prev => ({
      ...prev,
      [claimId]: {
        ...persistedClaim,
        ocrData: updatedOcrList,
        rules: updatedRules,
        flagSummary: updatedFlagSummary,
        isFlagged: updatedIsFlagged,
        recommendedPayout: newRecommendedPayout
      }
    }));

    // 5. Log the correction in the activity feed
    setActivityLogs(prev => [
      {
        id: Date.now(),
        type: 'success',
        text: `HITL OCR Override: "${editingOcrField.extractedValue}" → "${newValue}". AI rules re-evaluated.`,
        time: 'Just now'
      },
      ...prev
    ]);

    closeOcrModal();
    setTimeout(() => setIsAnalyzing(false), 650);
  };

  // ---------------------------------------------------------------------
  // 11. DECISION HANDLERS
  // ---------------------------------------------------------------------
  const handleDirectApprove = () => {
    setClaimsDb(prev => ({
      ...prev,
      [selectedClaimId]: { ...prev[selectedClaimId], status: 'Completed' }
    }));
  };

  const handleConfirmDenial = () => {
    if (!denialReason.trim()) {
      alert('Please enter a clear reason for denying this claim for regulatory compliance.');
      return;
    }
    setApprovedPayout(0);
    setClaimsDb(prev => ({
      ...prev,
      [selectedClaimId]: { ...prev[selectedClaimId], status: 'Denied' }
    }));
    setIsDenyModalOpen(false);
  };

  const handleSaveAndApproveEdit = () => {
    if (!overrideReason.trim()) {
      alert('Please enter your reason / comment for modifying the payout amount.');
      return;
    }
    setIsModified(true);
    setClaimsDb(prev => ({
      ...prev,
      [selectedClaimId]: { ...prev[selectedClaimId], status: 'Completed' }
    }));
    setIsModalOpen(false);
  };

  const handleSendEmail = () => {
    setEmailSent(true);
    setIsEmailModalOpen(false);
    alert(`Email successfully dispatched to ${activeClaim.email}!`);
  };

  // ---------------------------------------------------------------------
  // 12. RENDER
  // ---------------------------------------------------------------------
  return (
    <div className="h-full flex flex-col">
      <Navbar
        currentScreen={currentScreen}
        activeClaim={activeClaim}
        onBackToDashboard={() => setCurrentScreen('dashboard')}
      />

      {currentScreen === 'dashboard' && (
        <Dashboard
          claims={filteredClaims}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onSelectClaim={openClaimDetail}
          activityLogs={activityLogs}
        />
      )}

      {currentScreen === 'detail' && (
        <ClaimWorkspace
          activeClaim={activeClaim}
          approvedPayout={approvedPayout}
          isModified={isModified}
          overrideReason={overrideReason}
          denialReason={denialReason}
          emailSent={emailSent}
          requirements={{
            isAnalyzing,
            fileInputRef,
            onFileSelected: handleDocumentUpload,
            onUploadClick: triggerFilePicker,
            isChecklistChecked,
            onToggleRequirement: handleChecklistToggle,
            onViewDocument: setActiveDocId,
            onZoomImage: setZoomedImage,
            onOpenFormEditor: openFormEditor,
            onOpenLicenseEditor: openLicenseEditor
          }}
          ocr={{
            activeOcrFieldId,
            onSelectField: handleSelectField,
            onEditOcr: openOcrModal
          }}
          decision={{
            onApprove: handleDirectApprove,
            onEditPayout: () => setIsModalOpen(true),
            onDeny: () => setIsDenyModalOpen(true),
            onSendEmail: () => setIsEmailModalOpen(true)
          }}
          runAiAnalysis={runAiAnalysis}
          formEditorTarget={formEditorTarget}
         onCloseFormEditor={closeFormEditor}
         onSaveFormFields={handleSaveFormFields}
         licenseEditorTarget={licenseEditorTarget}             
          onCloseLicenseEditor={closeLicenseEditor}             
         onSaveLicenseFields={handleSaveLicenseFields}         

        />
      )}

      <ImageViewerModal
        image={zoomedImage}
        onClose={() => setZoomedImage(null)}
      />

      <OcrCorrectionModal
        field={editingOcrField}
        correctionValue={ocrCorrectionValue}
        onCorrectionValueChange={setOcrCorrectionValue}
        correctionNote={ocrCorrectionNote}
        onCorrectionNoteChange={setOcrCorrectionNote}
        onClose={closeOcrModal}
        onSave={handleSaveOcrCorrection}
      />

      <DenyClaimModal
        isOpen={isDenyModalOpen}
        activeClaim={activeClaim}
        denialReason={denialReason}
        onDenialReasonChange={setDenialReason}
        onClose={() => setIsDenyModalOpen(false)}
        onConfirm={handleConfirmDenial}
      />

      <EditPayoutModal
        isOpen={isModalOpen}
        approvedPayout={approvedPayout}
        onApprovedPayoutChange={setApprovedPayout}
        overrideReason={overrideReason}
        onOverrideReasonChange={setOverrideReason}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveAndApproveEdit}
      />

      <EmailModal
        isOpen={isEmailModalOpen}
        activeClaim={activeClaim}
        approvedPayout={approvedPayout}
        isModified={isModified}
        overrideReason={overrideReason}
        denialReason={denialReason}
        onClose={() => setIsEmailModalOpen(false)}
        onSend={handleSendEmail}
      />
    </div>
  );
}
