import ClaimRequirements from './claims/ClaimRequirements';
import ClaimAssessment from './claims/ClaimAssessment';

/**
 * Claim detail screen — the side-by-side HITL workspace.
 * Left half: requirements checklist + inline document previews.
 * Right half: AI assessment, policy rules and the decision bar.
 *
 * Pure layout: `requirements`, `ocr` and `decision` are prop bundles forwarded
 * straight from App.jsx to keep this signature readable.
 */
export default function ClaimWorkspace({
  activeClaim,
  approvedPayout,
  isModified,
  overrideReason,
  denialReason,
  emailSent,
  requirements,
  ocr,
  decision
}) {
  return (
    <main className="flex-1 flex overflow-hidden p-4 gap-4">

      <ClaimRequirements
        activeClaim={activeClaim}
        isAnalyzing={requirements.isAnalyzing}
        fileInputRef={requirements.fileInputRef}
        onFileSelected={requirements.onFileSelected}
        onUploadClick={requirements.onUploadClick}
        isChecklistChecked={requirements.isChecklistChecked}
        onToggleRequirement={requirements.onToggleRequirement}
        onViewDocument={requirements.onViewDocument}
        onZoomImage={requirements.onZoomImage}
        onEditOcr={ocr.onEditOcr}
      />

      <ClaimAssessment
        activeClaim={activeClaim}
        approvedPayout={approvedPayout}
        isModified={isModified}
        overrideReason={overrideReason}
        denialReason={denialReason}
        emailSent={emailSent}
        ocr={ocr}
        decision={decision}
      />

    </main>
  );
}
