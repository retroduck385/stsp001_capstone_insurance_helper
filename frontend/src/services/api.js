// services/api.js
//
// Every network call to the backend lives here, so there is exactly one place
// that knows the API's address.

import { withFlatOcrData } from './ocrAdapter';

export const API_BASE = 'http://localhost:5001';

/**
 * The backend stores file URLs as relative paths ("/uploads/scan.pdf") so they
 * stay correct if the API ever moves to a real domain. But this page is served
 * by Vite on port 5173, so a relative URL would resolve to
 * localhost:5173/uploads/scan.pdf and 404.
 *
 * Everything that arrives from the API therefore gets its file URLs rewritten
 * to absolute ones here, at the boundary. Components downstream stay unaware.
 */
export const toAbsoluteUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return `${API_BASE}${url}`;
};

/**
 * Prepares a claim straight from the API for use by the UI. Two jobs:
 *   1. rewrite document file URLs to absolute ones (see above);
 *   2. flatten the nested `ocrData` object into the array components expect
 *      (see services/ocrAdapter.js).
 *
 * `ocrDataRaw` keeps the original nested object, because that is the shape the
 * backend wants back when saving a correction.
 */
export function normaliseClaim(claim) {
  if (!claim) return claim;

  const withUrls = Array.isArray(claim.documents)
    ? {
        ...claim,
        documents: claim.documents.map(doc => ({
          ...doc,
          fileUrl: toAbsoluteUrl(doc.fileUrl),
          imageUrl: toAbsoluteUrl(doc.imageUrl)
        }))
      }
    : claim;

  return { ...withFlatOcrData(withUrls), ocrDataRaw: claim.ocrData };
}

/**
 * Turns a failed response into an Error carrying the server's own message,
 * so the UI can show something useful instead of "Failed to fetch".
 */
async function throwApiError(response, fallback) {
  let message = fallback;
  try {
    const body = await response.json();
    if (body?.message) message = body.message;
  } catch {
    // The response wasn't JSON (a proxy error page, say) — keep the fallback.
  }
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** GET /api/claims — every claim, newest first. */
export async function fetchClaims() {
  const response = await fetch(`${API_BASE}/api/claims`);
  if (!response.ok) await throwApiError(response, 'Failed to fetch claims from server');
  const claims = await response.json();
  return claims.map(normaliseClaim);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Builds the multipart body for an upload.
 *
 * IMPORTANT: never set a Content-Type header on a FormData request. The browser
 * has to set it itself, because it must include a generated boundary string
 * ("multipart/form-data; boundary=----WebKitFormBoundary..."). Setting it by
 * hand omits the boundary and the server cannot parse the body.
 */
function buildUploadBody(file, documentType) {
  const body = new FormData();
  body.append('file', file);            // must be named "file" — see routes/documents.js
  body.append('documentType', documentType);
  return body;
}

/**
 * POST /api/claims/:claimId/documents — upload a new document.
 * Resolves to the full updated claim.
 */
export async function uploadDocument(claimId, file, documentType) {
  const response = await fetch(`${API_BASE}/api/claims/${encodeURIComponent(claimId)}/documents`, {
    method: 'POST',
    body: buildUploadBody(file, documentType)
  });
  if (!response.ok) await throwApiError(response, 'Upload failed');
  return normaliseClaim(await response.json());
}

/**
 * PUT /api/claims/:claimId/documents/:docId — replace an existing document.
 * Resolves to the full updated claim.
 */
export async function replaceDocument(claimId, docId, file, documentType) {
  const url = `${API_BASE}/api/claims/${encodeURIComponent(claimId)}/documents/${encodeURIComponent(docId)}`;
  const response = await fetch(url, {
    method: 'PUT',
    body: buildUploadBody(file, documentType)
  });
  if (!response.ok) await throwApiError(response, 'Replace failed');
  return normaliseClaim(await response.json());
}

// ---------------------------------------------------------------------------
// OCR corrections
// ---------------------------------------------------------------------------

/**
 * PATCH /api/claims/:claimId/ocr — saves adjuster corrections.
 *
 * `patch` is the nested partial produced by buildOcrPatch(), e.g.
 *   { driversLicense: { driver_license_name: 'Juan Dela Cruz' } }
 *
 * Unlike the uploads this IS JSON, so Content-Type must be set explicitly.
 * Resolves to the full updated claim.
 */
export async function saveOcrCorrections(claimId, patch) {
  const response = await fetch(`${API_BASE}/api/claims/${encodeURIComponent(claimId)}/ocr`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!response.ok) await throwApiError(response, 'Could not save the correction');
  return normaliseClaim(await response.json());
}
