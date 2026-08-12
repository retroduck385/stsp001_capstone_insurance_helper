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
import {
  fetchClaims,
  uploadDocument,
  replaceDocument,
  deleteDocument,
  saveOcrCorrections,
  updateClaim
} from './services/api';
import { buildOcrPatch } from './services/ocrAdapter';

/**
 * Key for the adjuster's per-requirement tickbox state.
 *
 * Module scope on purpose: the load effect below needs it, and the guards in
 * section 4 return early on the very first render — so a `const` declared
 * inside the component would still be in its temporal dead zone when that
 * effect's callback runs.
 */
const checklistKey = (claimId, requirement) => `${claimId}::${requirement}`;

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
        const restoredChecklist = {};
        data.forEach(claim => {
          formattedData[claim.id] = claim;
          // Rebuild the tickbox state from what was saved. Without this the
          // checklist looked empty again after every refresh.
          (claim.confirmedRequirements || []).forEach(req => {
            restoredChecklist[checklistKey(claim.id, req)] = true;
          });
        });
        setClaimsDb(formattedData);
        setChecklistState(restoredChecklist);

        // Preselect the first claim so the workspace has something to show.
        if (data.length > 0) {
          setSelectedClaimId(data[0].id);
          // An adjuster-approved payout takes precedence over the AI's
          // suggestion — otherwise a saved override is invisible after reload.
          setApprovedPayout(data[0].approvedPayout ?? data[0].recommendedPayout ?? 0);
          setOverrideReason(data[0].status === 'Denied' ? '' : (data[0].decisionReason || ''));
          setDenialReason(data[0].status === 'Denied' ? (data[0].decisionReason || '') : '');
          setIsModified(data[0].status === 'Completed' && Boolean(data[0].decisionReason));
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

  /** Pushes one entry onto the activity feed. `type` is info/success/warning/danger. */
  const logActivity = (type, text) => {
    setActivityLogs(prev => [{ id: Date.now() + Math.random(), type, text, time: 'Just now' }, ...prev]);
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
      // A saved adjuster payout beats the AI's recommendation; the saved reason
      // is a denial reason on a denied claim and an override note otherwise.
      setApprovedPayout(target.approvedPayout ?? target.recommendedPayout ?? 0);
      setIsModified(target.status === 'Completed' && Boolean(target.decisionReason));
      setOverrideReason(target.status === 'Denied' ? '' : (target.decisionReason || ''));
      setDenialReason(target.status === 'Denied' ? (target.decisionReason || '') : '');
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
  const isChecklistChecked = (requirement) =>
    !!checklistState[checklistKey(selectedClaimId, requirement)];

  /**
   * Ticking a requirement now persists.
   *
   * The tickbox is updated optimistically so it doesn't lag behind the click,
   * then reverted if the save fails — a checkbox that silently un-ticks itself
   * is far less confusing than one that stays ticked over a failed write.
   */
  const handleChecklistToggle = async (requirement, checked) => {
    const claimId = selectedClaimId;
    const key = checklistKey(claimId, requirement);

    setChecklistState(prev => ({ ...prev, [key]: checked }));

    const current = claimsDb[claimId]?.confirmedRequirements || [];
    const next = checked
      ? [...new Set([...current, requirement])]
      : current.filter(item => item !== requirement);

    try {
      const updatedClaim = await updateClaim(claimId, { confirmedRequirements: next });
      setClaimsDb(prev => ({ ...prev, [claimId]: updatedClaim }));
    } catch (err) {
      setChecklistState(prev => ({ ...prev, [key]: !checked }));
      console.error(err);
      logActivity('danger', `Could not save the checklist tick: ${err.message}`);
    }
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
  // All of them are now declared in both the Mongoose schema and
  // data/ocrSchema.js, including driver_license_issue_date — which buildOcrPatch
  // used to drop silently, making the Issue Date box impossible to save.
  closeLicenseEditor();
  await persistOcrEdits(licensePayload, 'driversLicense', `Adjuster saved license edits on ${selectedClaimId}`);
};

  // ---------------------------------------------------------------------
  // 9. DOCUMENT UPLOAD HANDLERS
  // ---------------------------------------------------------------------
  /**
   * Opens the (single, shared) file picker on behalf of one requirement row.
   *
   * `documentType` is the requirement label that was clicked, and IT WINS.
   * The previous version preferred the existing document's type
   * (`existing?.documentType || documentType`), which meant that when a row
   * showed the wrong document — as the Official Receipt row did for everything —
   * uploading from it filed the new file under the OTHER row's type and
   * overwrote that document instead.
   */
  const triggerFilePicker = (docId = null, documentType = '') => {
    setReplaceDocId(docId);
    setUploadDocumentType(documentType || '');

    if (documentType && docId) {
      const proceed = window.confirm(
        `Replace the file filed under "${documentType}"?\n\n` +
        'The old file is deleted and the new one is re-read by the AI. Any values ' +
        'you have already corrected are kept — only blank fields get filled in.\n\n' +
        'To re-extract everything from scratch instead, cancel and use Remove first.'
      );
      if (!proceed) {
        setReplaceDocId(null);
        setUploadDocumentType('');
        return;
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  /** Deletes a document outright — file, record and its extracted fields. */
  const handleDeleteDocument = async (docId, requirement) => {
    const claimId = selectedClaimId;
    const doc = (claimsDb[claimId]?.documents || []).find(d => d.id === docId);
    if (!doc) return;

    const confirmed = window.confirm(
      `Remove "${doc.fileName || doc.title}" from ${requirement || 'this claim'}?\n\n` +
      'The file is deleted from the server and the AI-extracted fields for this ' +
      'document are cleared. This cannot be undone.'
    );
    if (!confirmed) return;

    setIsAnalyzing(true);
    try {
      const updatedClaim = await deleteDocument(claimId, docId);
      setClaimsDb(prev => ({ ...prev, [claimId]: updatedClaim }));
      logActivity('warning', `Document "${doc.fileName || doc.title}" removed from ${claimId}.`);
    } catch (err) {
      console.error(err);
      logActivity('danger', `Could not remove the document: ${err.message}`);
      alert(`Could not remove the document: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
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

    // The requirement row the adjuster clicked wins over the type already on
    // the document. See triggerFilePicker for why that ordering matters.
    const existingDoc = targetDocId
      ? (claimsDb[claimId]?.documents || []).find(doc => doc.id === targetDocId)
      : null;
    const documentType = uploadDocumentType || existingDoc?.documentType || '';

    if (!documentType) {
      alert('This upload must be started from a specific claim requirement.');
      event.target.value = '';
      return;
    }

    setIsAnalyzing(true);

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

      // The upload succeeds even when the AI extraction doesn't, so say plainly
      // which of the two happened rather than showing a success either way.
      if (updatedClaim.ocrWarning) {
        logActivity('warning', `"${file.name}" saved to ${documentType}, but the AI could not read it: ${updatedClaim.ocrWarning}`);
      }

      const summary = updatedClaim.ocrSummary;
      if (summary && (summary.preserved.length || summary.filled.length)) {
        logActivity(
          'info',
          `Re-analysis of ${documentType}: filled ${summary.filled.length} blank field(s)` +
          (summary.preserved.length ? `, kept ${summary.preserved.length} value(s) you had already corrected.` : '.')
        );
      }

      // Leaves isAnalyzing on for its own 650ms window, then clears it.
      runAiAnalysis(isReplacing ? `document replaced with ${file.name}` : `document ${file.name} uploaded`);
    } catch (err) {
      setIsAnalyzing(false);
      console.error(err);
      logActivity('danger', `Upload of "${file.name}" failed: ${err.message}`);
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
  /**
   * Writes a decision to MongoDB and takes the server's copy of the claim.
   *
   * Every one of these used to be a local setClaimsDb call, which is why the
   * dashboard forgot an approval the moment the page was refreshed. Returns
   * true on success so callers know whether to close their modal.
   */
  const persistDecision = async (patch, activityText) => {
    const claimId = selectedClaimId;
    setIsAnalyzing(true);
    try {
      const updatedClaim = await updateClaim(claimId, patch);
      setClaimsDb(prev => ({ ...prev, [claimId]: updatedClaim }));
      logActivity('success', activityText);
      return true;
    } catch (err) {
      console.error(err);
      logActivity('danger', `Could not save the decision: ${err.message}`);
      alert(`Could not save: ${err.message}`);
      return false;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDirectApprove = async () => {
    await persistDecision(
      { status: 'Completed', approvedPayout, decisionReason: '' },
      `${selectedClaimId} approved at ₱${approvedPayout.toLocaleString()}.`
    );
  };

  const handleConfirmDenial = async () => {
    if (!denialReason.trim()) {
      alert('Please enter a clear reason for denying this claim for regulatory compliance.');
      return;
    }
    const saved = await persistDecision(
      { status: 'Denied', approvedPayout: 0, decisionReason: denialReason },
      `${selectedClaimId} denied: "${denialReason}".`
    );
    if (!saved) return;

    setApprovedPayout(0);
    setIsDenyModalOpen(false);
  };

  const handleSaveAndApproveEdit = async () => {
    if (!overrideReason.trim()) {
      alert('Please enter your reason / comment for modifying the payout amount.');
      return;
    }
    const saved = await persistDecision(
      { status: 'Completed', approvedPayout, decisionReason: overrideReason },
      `${selectedClaimId} approved with an adjusted payout of ₱${approvedPayout.toLocaleString()}.`
    );
    if (!saved) return;

    setIsModified(true);
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
          allClaims={Object.values(claimsDb)}
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
            onDeleteDocument: handleDeleteDocument,
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
