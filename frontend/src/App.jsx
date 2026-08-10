import { useState, useRef, useEffect } from 'react';

import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import ClaimWorkspace from './components/ClaimWorkspace';
import ImageViewerModal from './components/modals/ImageViewerModal';
import OcrCorrectionModal from './components/modals/OcrCorrectionModal';
import DenyClaimModal from './components/modals/DenyClaimModal';
import EditPayoutModal from './components/modals/EditPayoutModal';
import EmailModal from './components/modals/EmailModal';

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
        const response = await fetch('http://localhost:5001/api/claims');
        if (!response.ok) throw new Error('Failed to fetch claims from server');

        const data = await response.json();

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

  const handleDocumentUpload = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const existingDoc = replaceDocId ? (claimsDb[selectedClaimId]?.documents || []).find(doc => doc.id === replaceDocId) : null;
    const documentType = existingDoc?.documentType || uploadDocumentType || '';
    if (!documentType) {
      alert('This upload must be started from a specific claim requirement.');
      event.target.value = '';
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');
    const newDoc = {
      id: replaceDocId || `doc-${Date.now()}`,
      title: file.name,
      type: isPdf ? 'pdf_document' : (isImage ? 'image_card' : 'uploaded_file'),
      fileUrl: objectUrl,
      fileName: file.name,
      mimeType: file.type,
      imageUrl: isImage ? objectUrl : null,
      imageLabel: isImage ? file.name : null,
      caption: 'Uploaded by adjuster for claim review.',
      documentType
    };

    setClaimsDb(prev => {
      const target = prev[selectedClaimId];
      if (!target) return prev;
      const docs = replaceDocId
        ? target.documents.map(doc => doc.id === replaceDocId ? { ...newDoc, title: doc.title || file.name } : doc)
        : [...(target.documents || []), newDoc];
      return {
        ...prev,
        [selectedClaimId]: { ...target, documents: docs, docsCount: docs.length }
      };
    });

    setActiveDocId(newDoc.id);
    setReplaceDocId(null);
    setUploadDocumentType('');
    setTimeout(() => scrollToDoc(newDoc.id), 50);
    runAiAnalysis(replaceDocId ? `document replaced with ${file.name}` : `document ${file.name} uploaded`);
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

  // Saving an OCR correction re-runs the (mock) rules engine.
  const handleSaveOcrCorrection = () => {
    if (!ocrCorrectionValue.trim()) {
      alert('Please enter the corrected value.');
      return;
    }

    const fieldId = editingOcrField.fieldId;
    const newValue = ocrCorrectionValue;
    setIsAnalyzing(true);

    // 1. Update the OCR item list
    const updatedOcrList = activeClaim.ocrData.map(item => {
      if (item.fieldId === fieldId) {
        return {
          ...item,
          correctedValue: newValue,
          isLowConfidence: false,
          issueNote: ocrCorrectionNote ? `Adjuster Note: ${ocrCorrectionNote}` : 'Adjuster verified & corrected field.'
        };
      }
      return item;
    });

    // 2. Re-evaluate the rules engine
    let updatedRules = [...activeClaim.rules];
    let updatedFlagSummary = activeClaim.flagSummary;
    const updatedIsFlagged = activeClaim.isFlagged;
    let newRecommendedPayout = activeClaim.recommendedPayout;

    // If the driver name was corrected, check whether it now matches the policyholder.
    if (fieldId === 'driver_name') {
      if (newValue.toLowerCase().trim() === activeClaim.policyholder.toLowerCase().trim()) {
        updatedRules = updatedRules.filter(r => !r.title.includes('Unnamed Driver'));
        updatedRules.push({
          type: 'green',
          title: '✓ Driver Identity Verified (OCR Corrected)',
          text: `Adjuster corrected driver name to "${newValue}", matching policyholder record exactly.`
        });

        newRecommendedPayout = 55000;
        setApprovedPayout(55000);
        updatedFlagSummary = '🔴 Battery Excluded (Driver Name Verified)';
      }
    }

    // 3. Write back to the in-memory database
    setClaimsDb(prev => ({
      ...prev,
      [selectedClaimId]: {
        ...prev[selectedClaimId],
        ocrData: updatedOcrList,
        rules: updatedRules,
        flagSummary: updatedFlagSummary,
        isFlagged: updatedIsFlagged,
        recommendedPayout: newRecommendedPayout
      }
    }));

    // 4. Log the correction in the activity feed
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
            onZoomImage: setZoomedImage
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
