/** Shared PDF embed URL builder — single source of truth */

/** Self-hosted PDF.js viewer (same-origin) so we can drive scroll programmatically. */
const PDFJS_VIEWER = "/pdfjs/web/viewer.html";

/** Google Drive file URL → preview embed */
export const isGoogleDrive = (url: string) => /drive\.google\.com/.test(url);

/** Google Docs document URL */
export const isGoogleDocs = (url: string) => /docs\.google\.com\/document/.test(url);

/** jsDelivr CDN URL (direct PDF hosting) */
export const isJsDelivrCdn = (url: string) => /cdn\.jsdelivr\.net/i.test(url);

/** GitHub Storages CDN viewer (already a viewer page) */
export const isGithubStoragesCdn = (url: string) =>
  /github-storages-cdn\.vercel\.app/i.test(url);

/** Naveen Bharat Storage viewer (already a viewer page) */
export const isNaveenBharatStorage = (url: string) =>
  /storage-naveenbharat-recording\.vercel\.app/i.test(url);

/** Extract Google Drive file ID */
export const extractDriveFileId = (url: string): string | null => {
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m1?.[1] || m2?.[1] || null;
};

/** Extract Google Docs document ID */
export const extractDocsId = (url: string): string | null => {
  const m = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m?.[1] || null;
};

/** Build PDF.js CDN viewer URL (fast, client-side rendering) */
export const pdfJsViewerUrl = (fileUrl: string): string =>
  `${PDFJS_VIEWER}?file=${encodeURIComponent(fileUrl)}#toolbar=0&navpanes=0&pagemode=none`;

/** Google Docs viewer fallback for external PDFs that block CORS */
export const googleDocsViewerUrl = (fileUrl: string): string =>
  `https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`;

/**
 * Detect any remote URL (used to gate routing through /pdfjs viewer).
 * Previously these routed to Google `gview`, which has NO autoscroll bridge
 * — silently failing with "Save this file to My Library to enable it".
 */
const isExternalPdf = (url: string): boolean => {
  try {
    const u = new URL(url);
    return !!u.hostname;
  } catch {
    return false;
  }
};

/**
 * Resolve the best embed URL for any document URL.
 * Returns { embedUrl, openUrl, isDrive }
 */
export function resolveEmbedUrl(url: string): {
  embedUrl: string;
  openUrl: string;
  isDrive: boolean;
} {
  // Local-origin URLs (blob:, data:, file:, capacitor://, ionic://) can't be
  // loaded by the remote PDF.js viewer (cross-origin). Browsers + Capacitor
  // WebView render these natively in an <iframe>, so embed directly.
  if (/^(blob:|data:|file:|capacitor:|ionic:)/i.test(url)) {
    return { embedUrl: url, openUrl: url, isDrive: false };
  }

  // Google Drive
  if (isGoogleDrive(url)) {
    const fileId = extractDriveFileId(url);
    if (fileId) {
      return {
        embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
        openUrl: `https://drive.google.com/file/d/${fileId}/view`,
        isDrive: true,
      };
    }
  }

  // Google Docs
  if (isGoogleDocs(url)) {
    const docId = extractDocsId(url);
    if (docId) {
      return {
        embedUrl: `https://docs.google.com/document/d/${docId}/preview`,
        openUrl: `https://docs.google.com/document/d/${docId}/edit`,
        isDrive: false,
      };
    }
  }

  // Custom viewer pages — embed directly
  if (isGithubStoragesCdn(url) || isNaveenBharatStorage(url)) {
    return { embedUrl: url, openUrl: url, isDrive: false };
  }

  // External PDFs → self-hosted PDF.js viewer (has nb-bridge.js for autoscroll).
  // gview was removed: it broke autoscroll and stalled 5–15 s on first paint.
  if (isExternalPdf(url)) {
    return {
      embedUrl: pdfJsViewerUrl(url),
      openUrl: url,
      isDrive: false,
    };
  }


  // Everything else (jsDelivr, Supabase, generic PDFs) → PDF.js CDN viewer.
  // (Was incorrectly returning gview here, which caused 5–15s "Loading PDF…"
  // stalls. PDF.js renders client-side and starts streaming pages immediately.)
  return {
    embedUrl: pdfJsViewerUrl(url),
    openUrl: url,
    isDrive: false,
  };
}
