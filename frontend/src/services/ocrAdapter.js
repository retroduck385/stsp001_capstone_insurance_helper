// services/ocrAdapter.js
//
// Converts the backend's nested `ocrData` object into the flat array the UI
// components expect, and converts edits back again.
//
// Read data/ocrSchema.js first — it defines the sections and fields this
// operates on.
//
// ── A LIMITATION WORTH KNOWING ────────────────────────────────────────────
// The Mongoose schema stores ONE value per field:
//
//     driversLicense: { driver_license_name: "Jan Dela Cruz" }
//
// The UI distinguishes two: `extractedValue` (what the AI read) and
// `correctedValue` (what the adjuster changed it to). There is nowhere in the
// current schema to keep both, so:
//
//   * within a session, a correction shows as extracted → corrected;
//   * after a reload, only the corrected value survives, and it appears as if
//     the AI had read it correctly all along.
//
// The capstone brief asks for corrections to be "auditable alongside the
// adjuster's edits", so this is worth raising with the backend developer. The
// fix is on their side: store each field as { value, aiValue, confidence,
// correctedBy, correctedAt } rather than a bare string. This adapter is
// written so that only `flattenOcrData` would need to change.

import { OCR_SECTIONS, SECTION_BY_KEY, sectionKeyForDocument } from '../data/ocrSchema';

/** Values the backend uses to mean "the OCR hasn't filled this in". */
const isEmpty = (value) =>
  value === null || value === undefined || value === '' ||
  (Array.isArray(value) && value.length === 0);

/** Dates arrive from JSON as ISO strings; show just the date part. */
function displayValue(value, field) {
  if (isEmpty(value)) return '';
  if (field.isTable) return Array.isArray(value) ? value : [];
  if (field.isDate && typeof value === 'string' && value.includes('T')) return value.split('T')[0];
  return value;
}

/**
 * Maps each document on the claim to its ocrData section.
 * Returns { [sectionKey]: documentId } — the first document that matches a
 * section wins, so a replaced document keeps its link.
 */
export function mapSectionsToDocuments(documents = []) {
  const bySection = {};
  for (const doc of documents) {
    const key = sectionKeyForDocument(doc);
    if (key && !bySection[key]) bySection[key] = doc.id;
  }
  return bySection;
}

/**
 * THE MAIN CONVERSION — nested object → flat array.
 *
 * Produces the item shape every OCR component already expects:
 *   { fieldId, label, extractedValue, correctedValue, confidence,
 *     isLowConfidence, sourceDoc, issueNote, section }
 *
 * `sourceDoc` is what links a field to the document it came from — it's how
 * DocumentPreview and the editors know which fields to show.
 *
 * Accepts a claim whose ocrData is the nested object OR already an array (in
 * which case it is passed straight through), so this is safe to call on data
 * from either schema version.
 */
export function flattenOcrData(claim) {
  if (!claim) return [];
  const { ocrData, documents } = claim;

  // Already flat — older data, or a claim that has been through here before.
  if (Array.isArray(ocrData)) return ocrData;
  if (!ocrData || typeof ocrData !== 'object') return [];

  const documentBySection = mapSectionsToDocuments(documents);
  const items = [];

  for (const section of OCR_SECTIONS) {
    const sectionData = ocrData[section.key];
    if (!sectionData || typeof sectionData !== 'object') continue;

    for (const field of section.fields) {
      const raw = sectionData[field.id];

      // Skip fields the OCR hasn't populated — otherwise every claim would show
      // ~100 blank rows.
      if (isEmpty(raw)) continue;

      items.push({
        fieldId: field.id,
        label: field.label,
        extractedValue: displayValue(raw, field),
        correctedValue: null,
        confidence: 'Not provided',   // the schema stores no confidence score
        isLowConfidence: false,
        sourceDoc: documentBySection[section.key] || null,
        issueNote: `Extracted from ${section.label}.`,
        section: section.key          // needed to write the value back
      });
    }
  }

  return items;
}

/**
 * Returns a copy of the claim with ocrData flattened, leaving everything else
 * untouched. Call this once when a claim arrives from the API.
 */
export function withFlatOcrData(claim) {
  if (!claim) return claim;
  return { ...claim, ocrData: flattenOcrData(claim) };
}

/**
 * THE REVERSE CONVERSION — flat edits → the nested shape the backend stores.
 *
 * `edits` is { fieldId: newValue }, as both editors emit.
 * `sectionKey` says which section they belong to; when omitted it is inferred
 * per-field from the schema, which is what the OCR correction modal needs since
 * it edits one field at a time from anywhere.
 *
 * Returns { motorClaimForm: { assured_full_name: 'Juan' }, ... } — only the
 * fields that actually changed, ready to PATCH.
 */
export function buildOcrPatch(edits, sectionKey = null, currentNested = null) {
  const patch = {};

  for (const [fieldId, value] of Object.entries(edits || {})) {
    let key = sectionKey;

    if (!key) {
      const owner = OCR_SECTIONS.find(s => s.fields.some(f => f.id === fieldId));
      key = owner?.key;
    }
    // A field the backend schema doesn't define would be silently dropped by
    // Mongoose anyway, so don't send it.
    if (!key || !SECTION_BY_KEY[key]?.fields.some(f => f.id === fieldId)) continue;

    // Send only what actually changed. The form editor submits all ~57 of its
    // fields on every save, most of them empty strings — without this filter a
    // single edit would blank every field the editor didn't happen to display.
    if (currentNested) {
      const before = currentNested?.[key]?.[fieldId];
      if (isSameValue(before, value)) continue;
    }

    patch[key] = patch[key] || {};
    patch[key][fieldId] = value;
  }

  return patch;
}

/** Treats null / undefined / '' as equivalent, and compares arrays by content. */
function isSameValue(a, b) {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return String(a ?? '') === String(b ?? '');
}

/**
 * Applies a patch to a claim's nested ocrData locally, so the UI can update
 * immediately without waiting for a refetch. Mirrors what the backend does.
 */
export function applyOcrPatch(nestedOcrData, patch) {
  const next = { ...(nestedOcrData || {}) };
  for (const [sectionKey, fields] of Object.entries(patch)) {
    next[sectionKey] = { ...(next[sectionKey] || {}), ...fields };
  }
  return next;
}
