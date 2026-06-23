import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import PdfViewer from "../video/LazyPdfViewer";
import ReaderSkeleton from "./ReaderSkeleton";
import ReaderErrorOverlay from "./ReaderErrorOverlay";
import { usePdfResumePosition } from "../../hooks/usePdfResumePosition";
import { openExternal } from "../../lib/native/browser";
import { cn } from "../../lib/utils";

interface DocumentReaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  url: string;
  onBack: () => void;
  /** Optional stable id used to persist last-page across re-opens. */
  lessonId?: string | null;
}

const HIDE_AFTER_MS = 3000;
const ERROR_TIMEOUT_MS = 15000;

/**
 * Immersive document reader for PDF / DPP / Notes.
 *
 * UX:
 *  - No bottom Prev/Next bar.
 *  - Top header auto-hides after 3s; tap top edge or swipe down to reveal.
 *  - Fullscreen toggle for a true cinema mode.
 *  - Loading skeleton + error overlay with Retry / Open-externally.
 *  - Last-viewed page is restored when the lesson is re-opened.
 */
const DocumentReader = memo(
  ({ title, subtitle, badge, url, onBack, lessonId }: DocumentReaderProps) => {
    const [chromeVisible, setChromeVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showSkeleton, setShowSkeleton] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);

    const rootRef = useRef<HTMLDivElement>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { initialPage, savePage } = usePdfResumePosition({ lessonId, url });

    // ── Chrome auto-hide ────────────────────────────────────────────────────
    const clearHide = useCallback(() => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }, []);

    const scheduleHide = useCallback(() => {
      clearHide();
      const ms = isFullscreen ? 1500 : HIDE_AFTER_MS;
      hideTimerRef.current = setTimeout(() => setChromeVisible(false), ms);
    }, [clearHide, isFullscreen]);

    const showChrome = useCallback(() => {
      setChromeVisible(true);
      scheduleHide();
    }, [scheduleHide]);

    const hideChrome = useCallback(() => {
      clearHide();
      setChromeVisible(false);
    }, [clearHide]);

    useEffect(() => {
      scheduleHide();
      return clearHide;
    }, [scheduleHide, clearHide]);

    // ── Skeleton fade + error timeout ───────────────────────────────────────
    useEffect(() => {
      setShowSkeleton(true);
      setErrorMsg(null);
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      // Skeleton fades after 900ms — PdfViewer has its own loader for the
      // remainder, which keeps perceived latency low even on slow networks.
      skeletonTimerRef.current = setTimeout(() => setShowSkeleton(false), 900);
      errorTimerRef.current = setTimeout(() => {
        setErrorMsg("Still loading… the file may be unavailable.");
      }, ERROR_TIMEOUT_MS);
      return () => {
        if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      };
    }, [url, retryNonce]);

    // Cancel error-timeout if window emits a generic pdf-ready (FastPdfReader
    // dispatches this when first page paints — opt-in, safe if missing).
    useEffect(() => {
      const onReady = () => {
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        setShowSkeleton(false);
      };
      const onErr = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        setErrorMsg(typeof detail === "string" ? detail : "The document failed to load.");
      };
      window.addEventListener("pdf-ready", onReady);
      window.addEventListener("pdf-error", onErr as EventListener);
      return () => {
        window.removeEventListener("pdf-ready", onReady);
        window.removeEventListener("pdf-error", onErr as EventListener);
      };
    }, []);

    // ── Fullscreen ──────────────────────────────────────────────────────────
    useEffect(() => {
      const onChange = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", onChange);
      return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    const toggleFullscreen = useCallback(async () => {
      const el = rootRef.current;
      if (!el) return;
      try {
        if (!document.fullscreenElement) {
          await el.requestFullscreen?.();
        } else {
          await document.exitFullscreen?.();
        }
      } catch {
        // iOS Safari WebView / older Android may throw — fail silently.
      }
    }, []);

    // ── Swipe gestures (vertical only; horizontal needs 2 fingers) ──────────
    useEffect(() => {
      const el = rootRef.current;
      if (!el) return;
      let startX = 0;
      let startY = 0;
      let startT = 0;
      let touchCount = 0;

      const onStart = (e: TouchEvent) => {
        if (e.touches.length > 2) return;
        touchCount = e.touches.length;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
      };
      const onEnd = (e: TouchEvent) => {
        if (touchCount === 0) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const dt = Date.now() - startT;
        if (dt > 600) return;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        // Vertical swipe (single finger): reveal/hide chrome.
        if (touchCount === 1 && absY > 40 && absY > absX * 1.5) {
          if (dy > 0 && startY < 120) showChrome();
          else if (dy < 0 && chromeVisible) hideChrome();
        }
      };

      el.addEventListener("touchstart", onStart, { passive: true });
      el.addEventListener("touchend", onEnd, { passive: true });
      return () => {
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchend", onEnd);
      };
    }, [chromeVisible, showChrome, hideChrome]);

    // ── Retry ───────────────────────────────────────────────────────────────
    const handleRetry = useCallback(() => {
      setErrorMsg(null);
      setRetryNonce((n) => n + 1);
    }, []);

    const handleOpenExternal = useCallback(() => {
      try {
        openExternal(url);
      } catch {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }, [url]);

    return (
      <div
        ref={rootRef}
        className="fixed inset-0 bg-background flex flex-col overflow-hidden"
      >
        {/* Auto-hiding header */}
        <header
          onClick={showChrome}
          className={cn(
            "absolute top-0 left-0 right-0 z-30 bg-card/95 backdrop-blur border-b",
            "flex items-center gap-2 px-3 py-3 shadow-sm safe-area-top",
            "transition-transform duration-300 ease-out will-change-transform",
            chromeVisible ? "translate-y-0" : "-translate-y-full"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (document.fullscreenElement) {
                document.exitFullscreen?.().catch(() => {});
              }
              onBack();
            }}
            aria-label="Go back"
            className="min-h-[44px] min-w-[44px]"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-foreground line-clamp-1">{title}</h1>
            {subtitle && (
              <p className="text-xs text-muted-foreground line-clamp-1">{subtitle}</p>
            )}
          </div>
          {badge && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {badge}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="min-h-[44px] min-w-[44px]"
          >
            {isFullscreen ? (
              <Minimize2 className="h-5 w-5" />
            ) : (
              <Maximize2 className="h-5 w-5" />
            )}
          </Button>
        </header>

        {/* Full-bleed document */}
        <div className="flex-1 flex flex-col w-full h-full relative">
          <PdfViewer
            key={`${url}#${retryNonce}`}
            url={url}
            title={title}
            filename={title}
            initialPage={initialPage}
            onPageChange={savePage}
          />
          {showSkeleton && !errorMsg && <ReaderSkeleton />}
          {errorMsg && (
            <ReaderErrorOverlay
              message={errorMsg}
              onRetry={handleRetry}
              onOpenExternal={handleOpenExternal}
            />
          )}
        </div>

        {/* Top-edge tap strip — only mounted when chrome hidden. 6px so it
            never blocks PDF scrolling near the top edge. */}
        {!chromeVisible && (
          <button
            type="button"
            aria-label="Show reader controls"
            onClick={showChrome}
            className="absolute top-0 left-0 right-0 h-1.5 z-40 bg-transparent safe-area-top"
          />
        )}
      </div>
    );
  }
);

DocumentReader.displayName = "DocumentReader";

export default DocumentReader;
