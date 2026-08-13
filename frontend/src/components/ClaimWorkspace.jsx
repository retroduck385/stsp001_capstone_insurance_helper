// components/ClaimWorkspace.jsx
import ClaimRequirements from './claims/ClaimRequirements';
import ClaimAssessment from './claims/ClaimAssessment';
import DocumentFormEditor from './DocumentFormEditor';
import DriverLicenseEditor from './DriverLicenseEditor';

/**
 * Claim detail screen — the side-by-side HITL workspace.
 */
export default function ClaimWorkspace({
  activeClaim,
  approvedPayout,
  assessment,
  isModified,
  overrideReason,
  denialReason,
  emailSent,
  requirements,
  ocr,
  decision,
  fraud,
  // form editor props (from App.jsx)
  formEditorTarget,
  onCloseFormEditor,
  onSaveFormFields,
  // license editor props (from App.jsx)
  licenseEditorTarget,
  onCloseLicenseEditor,
  onSaveLicenseFields,
  runAiAnalysis
}) {
  // show the editor only when the target is set and the requirement matches
  const isEditingMotorForm =
    formEditorTarget?.docId &&
    (formEditorTarget.requirement || '').toLowerCase().includes('motor claim form');

  // Exact, not `includes`: the label "Official Receipt (Driver License /
  // Vehicle OR other relevant OR)" also contains "driver license", and matching
  // it here would open the licence editor over a receipt.
  const isEditingLicense =
    licenseEditorTarget?.docId &&
    (licenseEditorTarget.requirement || '').toLowerCase().trim() === "driver's license";

  // find the document referenced by formEditorTarget.docId (if any)
  const formEditorDoc = isEditingMotorForm
    ? (activeClaim.documents || []).find(d => d.id === formEditorTarget.docId)
    : null;

  // find the license document referenced by licenseEditorTarget.docId (if any)
  const licenseEditorDoc = isEditingLicense
    ? (activeClaim.documents || []).find(d => d.id === licenseEditorTarget.docId)
    : null;

  return (
    <main className="flex-1 flex overflow-hidden p-4 gap-4">

      <ClaimRequirements
        activeClaim={activeClaim}
        isAnalyzing={requirements.isAnalyzing}
        fileInputRef={requirements.fileInputRef}
        onFileSelected={requirements.onFileSelected}
        onUploadClick={requirements.onUploadClick}
        onDeleteDocument={requirements.onDeleteDocument}
        isChecklistChecked={requirements.isChecklistChecked}
        onToggleRequirement={requirements.onToggleRequirement}
        onViewDocument={requirements.onViewDocument}
        onZoomImage={requirements.onZoomImage}
        onEditOcr={ocr.onEditOcr}
        // forward both editor openers to the requirements panel
        onOpenFormEditor={requirements.onOpenFormEditor}
        onOpenLicenseEditor={requirements.onOpenLicenseEditor}
      />

      {isEditingLicense ? (
  <section className="w-1/2 flex flex-col space-y-4 overflow-y-auto pr-1">
    <DriverLicenseEditor
      doc={licenseEditorDoc}
      ocrData={activeClaim.ocrData}
      onClose={onCloseLicenseEditor}
      onSave={onSaveLicenseFields}
      runAiAnalysis={runAiAnalysis}
    />
  </section>
      ) : isEditingMotorForm ? (
        // Motor claim form editor (right panel)
        <section className="w-1/2 flex flex-col space-y-4 overflow-y-auto pr-1">
          <DocumentFormEditor
            doc={formEditorDoc}
            ocrData={activeClaim.ocrData}
            onClose={onCloseFormEditor}
            onSave={onSaveFormFields}
            runAiAnalysis={runAiAnalysis}
          />
        </section>
      ) : (
        // Default: assessment + rules + decision bar
        <ClaimAssessment
          assessment={assessment}
          activeClaim={activeClaim}
          // The ADJUSTER's payout, not the cross-checker's recommendation.
          //
          // This used to pass assessment?.["Reccomended Payout"], which threw
          // away the prop App.jsx supplies. The effect was that Edit Payout,
          // Approve and Reopen all updated state that nothing on screen read,
          // so the workspace showed a frozen AI figure while the database held
          // the real one — and the tile is labelled "Approved Payout", which
          // the recommendation is not.
          //
          // The recommendation is still the starting value: openClaimDetail
          // seeds this state with `approvedPayout ?? recommendedPayout ?? 0`,
          // so an unassessed claim opens on the AI's number and then follows
          // the adjuster from there.
          approvedPayout={approvedPayout}
          isModified={isModified}
          overrideReason={overrideReason}
          denialReason={denialReason}
          emailSent={emailSent}
          ocr={ocr}
          decision={decision}
          fraud={fraud}
        />
      )}

    </main>
  );
}

