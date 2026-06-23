import { Suspense, useEffect, type ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { lazyWithRetry } from "../../lib/lazyWithRetry";

/**
 * Lazy wrapper around PdfViewerWithAutoScroll.
 *
 * Why: react-pdf + pdfjs-dist together weigh ~131KB gzip. Statically
 * importing them in LessonView.tsx loaded the chunk for every lesson —
 * including video-only lessons that never open a PDF. This wrapper
 * defers the chunk until a PDF is actually rendered, and warm-prefetches
 * it on idle so the first tap still feels instant (<200ms warm load).
 *
 * Drop-in replacement: same props as PdfViewerWithAutoScroll. No ref
 * forwarding because no current call-site in LessonView uses one.
 */
const InnerPdfViewer = lazyWithRetry(
  () => import("./PdfViewerWithAutoScroll"),
);

type Props = ComponentProps<typeof import("./PdfViewerWithAutoScroll").default>;

// Warm-prefetch the chunk after first paint so the first PDF tap is
// instant. Runs once per session; safe on web + Capacitor.
let prefetched = false;
function prefetchPdfViewer() {
  if (prefetched) return;
  prefetched = true;
  // requestIdleCallback isn't available on iOS WebView — fall back to setTimeout.
  const ric: (cb: () => void) => void =
    (typeof window !== "undefined" && (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback) ||
    ((cb: () => void) => setTimeout(cb, 1500));
  ric(() => { void import("./PdfViewerWithAutoScroll"); });
}

function Fallback() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[300px] bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function LazyPdfViewer(props: Props) {
  useEffect(() => { prefetchPdfViewer(); }, []);
  return (
    <Suspense fallback={<Fallback />}>
      <InnerPdfViewer {...props} />
    </Suspense>
  );
}

// Allow external callers (e.g. a lesson page mounting) to warm the chunk.
export { prefetchPdfViewer };