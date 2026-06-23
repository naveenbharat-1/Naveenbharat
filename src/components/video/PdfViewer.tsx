import { memo, useMemo, useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { resolveEmbedUrl, isNaveenBharatStorage, isGithubStoragesCdn, isGoogleDrive, isGoogleDocs } from "../../lib/pdfViewerUrl";
import MarkdownViewer, { type MarkdownViewerHandle } from "./MarkdownViewer";
import FastPdfReader, { type FastPdfReaderHandle } from "./FastPdfReader";
import { useScreenProtection } from "../../hooks/useScreenProtection";
import { useOfflineResolvedUrl } from "../../hooks/useOfflineResolvedUrl";
import { pushPlayerBusy } from "../../lib/playerBusy";
import { openExternal } from "../../lib/native/browser";

interface PdfViewerProps {
  url: string;
  title?: string;
  filename?: string;
  chromeVisible?: boolean;
  onSurfaceTap?: () => void;
  onDownloaded?: (info: { title: string; url: string; filename: string }) => void;
  /** Page to restore on open (1-based). */
  initialPage?: number;
  /** Notified when the most-visible page changes (1-based). */
  onPageChange?: (page: number) => void;
}

export type PdfViewerHandle = {
  getScrollEl: () => HTMLElement | null;
  getIframeEl: () => HTMLIFrameElement | null;
};

const isMarkdownUrl = (u: string) => /\.(md|markdown)(\?|#|$)/i.test(u);

/**
 * URLs that must stay as iframe embeds (we can't render them as canvas).
 * NOTE: local files (capacitor://, file://, ionic://, blob:, http://localhost
 * _capacitor_file_…) are intentionally NOT here anymore — they now render through
 * FastPdfReader (canvas) so offline autoscroll + large-PDF streaming work.
 */
const mustUseIframe = (u: string) =>
  isGoogleDrive(u) ||
  isGoogleDocs(u);
// Note: github-storages-cdn used to be here; removed so its PDFs render via
// FastPdfReader (canvas) which supports autoscroll.

const PdfViewerInner = forwardRef<PdfViewerHandle, PdfViewerProps>(
  ({ url: rawUrl, title, filename, chromeVisible = true, onSurfaceTap, initialPage, onPageChange }, ref) => {
    useScreenProtection(true);
    useEffect(() => pushPlayerBusy(), []);

    // Prefer an offline-downloaded copy when one exists for this URL.
    const { url } = useOfflineResolvedUrl(rawUrl);

    // ── All hooks declared up-front (rules-of-hooks) ────────────────────────
    const mdRef = useRef<MarkdownViewerHandle>(null);
    const pdfRef = useRef<FastPdfReaderHandle>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const isMd = isMarkdownUrl(url) || (!!filename && isMarkdownUrl(filename));
    const useIframe = !isMd && mustUseIframe(url);

    useImperativeHandle(
      ref,
      () => ({
        getScrollEl: () =>
          mdRef.current?.getScrollEl() ?? pdfRef.current?.getScrollEl() ?? null,
        getIframeEl: () => iframeRef.current ?? pdfRef.current?.getIframeEl() ?? null,
      }),
      []
    );

    // iframe-branch state (safe to declare regardless of branch — React only
    // cares that the hook order is stable per component instance).
    const [loaded, setLoaded] = useState(false);
    const [showOpenExternal, setShowOpenExternal] = useState(false);
    const loadedRef = useRef(false);

    const resolved = useMemo(() => resolveEmbedUrl(url), [url]);
    const { isDrive } = resolved;
    const isHtmlViewer = isNaveenBharatStorage(url) || isGithubStoragesCdn(url);
    const embedUrl = resolved.embedUrl;

    useEffect(() => {
      if (!useIframe) return;
      setLoaded(false);
      loadedRef.current = false;
      setShowOpenExternal(false);
      const t = window.setTimeout(() => {
        if (!loadedRef.current) setShowOpenExternal(true);
      }, 10000);
      return () => window.clearTimeout(t);
    }, [embedUrl, useIframe]);

    // ── Markdown branch ──────────────────────────────────────────────────────
    if (isMd) {
      return (
        <div
          className={
            chromeVisible
              ? "relative w-full overflow-hidden bg-card"
              : "absolute inset-0 w-full h-full overflow-hidden bg-card"
          }
          style={
            chromeVisible
              ? { height: "calc(100dvh - 220px + env(safe-area-inset-bottom))", minHeight: "60vh" }
              : undefined
          }
        >
          <MarkdownViewer ref={mdRef} url={url} title={title} />
        </div>
      );
    }

    // ── Fast native PDF branch (canvas, no iframe) ───────────────────────────
    if (!useIframe) {
      return (
        <div
          className={
            chromeVisible
              ? "relative w-full overflow-hidden bg-card landscape:!h-[calc(100dvh-var(--nb-player-h,56.25vw)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] landscape:!min-h-[200px]"
              : "absolute inset-0 w-full h-full overflow-hidden bg-card"
          }
          style={
            chromeVisible
              ? { height: "calc(100dvh - 220px + env(safe-area-inset-bottom))", minHeight: "60vh" }
              : undefined
          }
        >
          <FastPdfReader
            ref={pdfRef}
            url={url}
            onSurfaceTap={onSurfaceTap}
            initialPage={initialPage}
            onPageChange={onPageChange}
          />
        </div>
      );
    }

    // ── Fallback iframe branch (Drive, Docs, custom viewer pages) ────────────
    const TOOLBAR_HIDE_PX = isDrive ? 72 : isHtmlViewer ? 56 : 0;

    const wrapperClass = chromeVisible
      ? "relative w-full overflow-hidden bg-card landscape:!h-[calc(100dvh-var(--nb-player-h,56.25vw)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] landscape:!min-h-[200px]"
      : "absolute inset-0 w-full h-full overflow-hidden bg-card";

    const wrapperStyle: React.CSSProperties = chromeVisible
      ? {
          height: "calc(100dvh - 220px + env(safe-area-inset-bottom))",
          minHeight: "60vh",
          transition: "height 250ms ease",
        }
      : {};

    return (
      <div className={wrapperClass} style={wrapperStyle} onClick={onSurfaceTap}>
        <iframe
          ref={iframeRef}
          key={embedUrl}
          src={embedUrl}
          className="absolute left-0 w-full border-0"
          style={{ top: -TOOLBAR_HIDE_PX, height: `calc(100% + ${TOOLBAR_HIDE_PX}px)` }}
          title={title || "PDF Document"}
          allow="fullscreen"
          {...(isDrive ? { sandbox: "allow-scripts allow-same-origin allow-popups allow-forms" } : {})}
          loading="eager"
          onLoad={() => {
            loadedRef.current = true;
            setLoaded(true);
          }}
        />
        {!loaded && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/90">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading PDF…</p>
            {showOpenExternal && (
              <button
                type="button"
                onClick={() => openExternal(url)}
                className="inline-flex items-center gap-1 text-xs text-primary underline"
              >
                <ExternalLink className="h-3 w-3" /> Open externally
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);

PdfViewerInner.displayName = "PdfViewer";
const PdfViewer = memo(PdfViewerInner);
export default PdfViewer;
