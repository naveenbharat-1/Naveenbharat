import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { App as AppPlugin } from "@capacitor/app";
import { useAuth } from "../contexts/AuthContext";
import { useNavigationHistory } from "../contexts/NavigationHistoryContext";
import { isAndroid } from "../lib/platform";
import { EXIT_ROUTES, AUTH_ROUTES, resolveBackTarget } from "../config/backNavigation";

// Static dynamic import — Vite code-splits @capacitor/app into the
// vendor-capacitor chunk so the bare specifier actually resolves at runtime
// inside the WebView. The previous `import(/* @vite-ignore */ pkg)` form
// kept the bare specifier in the built code, which the browser can't resolve
// without a bundler → "Failed to resolve module specifier '@capacitor/app'".
// See useAndroidBackButton.test.tsx.
const loadAppPlugin = async (): Promise<typeof AppPlugin> => {
  const mod = await import("@capacitor/app");
  return mod.App as typeof AppPlugin;
};

// Module-level singleton: prevents StrictMode/HMR async races from registering
// a second backButton listener. The listener reads `latest` instead of closing
// over one hook instance that may have unmounted during StrictMode.
let activeHookCount = 0;
let setupPromise: Promise<void> | null = null;
let removeBackButtonListener: (() => void) | null = null;
let lastBackAt = 0;
let lastExitAttemptAt = 0;
let lastExitOutcome: string = "none";
const latest = {
  path: "/",
  isAuthenticated: false,
  isAdmin: false,
  navigate: null as ReturnType<typeof useNavigate> | null,
  history: null as ReturnType<typeof useNavigationHistory> | null,
};

export const getBackButtonDebug = () => ({
  path: latest.path,
  isAuthenticated: latest.isAuthenticated,
  isAdmin: latest.isAdmin,
  lastBackAt,
  msSinceLastBack: lastBackAt ? Date.now() - lastBackAt : null,
  lastExitAttemptAt,
  lastExitOutcome,
  historyState: typeof window !== "undefined" ? window.history.state : null,
  activeHookCount,
  listenerRegistered: !!removeBackButtonListener,
});

export const useAndroidBackButton = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin } = useAuth();
  const navHistory = useNavigationHistory();

  latest.path = location.pathname;
  latest.isAuthenticated = isAuthenticated;
  latest.isAdmin = isAdmin;
  latest.navigate = navigate;
  latest.history = navHistory;

  // The `latest` module-level object intentionally avoids the dependency
  // list — we want ONE listener for the app lifetime, not one per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Android-only guard. `isNative()` was wrong — it returns true on iOS too,
    // which would let `App.exitApp()` fire later in the chain. Apple rejects
    // apps that programmatically terminate. iOS gets no back-button handler
    // (the platform doesn't have a hardware back anyway).
    if (!isAndroid()) return;
    activeHookCount += 1;

    const setup = async () => {
      if (removeBackButtonListener || setupPromise) return setupPromise;
      setupPromise = (async () => {
        try {
          // Bail out early if all hooks unmounted before we got here.
          if (activeHookCount === 0) return;

          // Double-check after the dynamic import await — if the tree
          // unmounted during import, skip listener registration entirely.
          if (activeHookCount === 0) return;

          const App = await loadAppPlugin();
          const listener = await App.addListener("backButton", ({ canGoBack }) => {
            const path = latest.path;
            const nav = latest.navigate;
            const history = latest.history;
            if (!nav || !history) return;
            const scrollTop =
              (typeof document !== "undefined" &&
                (document.scrollingElement?.scrollTop ??
                  document.documentElement.scrollTop)) ||
              0;
            const searchStr = typeof window !== "undefined" ? window.location.search : "";
            if (import.meta.env.DEV) console.warn("[back] press", {
              path,
              search: searchStr,
              canGoBack,
              scrollTop,
              stack: history.getStack().slice(-4),
            });

            // 1. Fullscreen overlay (PDF / player / rotation-guard / sheet /
            //    dialog) sentinel. `rotationGuard` (MahimaGhostPlayer) and
            //    `askDoubtSheet` were previously uncovered — pressing back
            //    fell through to navigation/exit instead of closing the
            //    overlay.
            const histState = window.history.state;
            if (
              histState?.pdfFullscreen ||
              histState?.playerFullscreen ||
              histState?.rotationGuard ||
              histState?.askDoubtSheet ||
              histState?.overlay
            ) {
              if (import.meta.env.DEV) console.warn("[back] step=1 overlay-pop");
              window.history.back();
              return;
            }

            // 2. Auth pages while authenticated → role-aware home.
            if (latest.isAuthenticated && (AUTH_ROUTES as readonly string[]).includes(path)) {
              const home = latest.isAdmin ? "/admin" : "/dashboard";
              if (import.meta.env.DEV) console.warn("[back] step=2 auth-route → home", home);
              nav(home, { replace: true });
              return;
            }

            // 3. EXIT ROUTES FIRST — once the user is back on a home anchor
            // (`/dashboard`, `/`, `/index`, `/admin`), the next back MUST
            // trigger the double-tap exit gesture. We intentionally short-
            // circuit BEFORE the trail/parent-map steps so a long browse
            // history can never trap the user on dashboard forever.
            if ((EXIT_ROUTES as readonly string[]).includes(path)) {
              const now = Date.now();
              if (now - lastBackAt < 2000) {
                if (import.meta.env.DEV) console.warn("[back] exit gesture confirmed → minimizeApp()");
                lastExitAttemptAt = now;
                lastExitOutcome = "attempting";
                // `minimizeApp()` mirrors Home-button behavior and works
                // reliably on Android 12+/OEM skins where `exitApp()` is
                // often a no-op. Keep `exitApp()` as a belt-and-suspenders
                // fallback in case minimize is unavailable.
                (async () => {
                  try {
                    const App = await loadAppPlugin();
                    await App.minimizeApp();
                    lastExitOutcome = "minimized";
                    if (import.meta.env.DEV) console.warn("[back] minimizeApp() ok");
                  } catch (e) {
                    lastExitOutcome = "minimize-failed:" + String(e);
                    console.error("[back] minimizeApp() failed", e);
                    try {
                      const App = await loadAppPlugin();
                      await App.exitApp();
                      lastExitOutcome = "exited";
                    } catch (e2) {
                      lastExitOutcome = "exit-failed:" + String(e2);
                      console.error("[back] exitApp() failed", e2);
                    }
                  }
                })();
              } else {
                lastBackAt = now;
                // Dispatch the in-app pill (ExitHint listens for this)
                // AND a deduped sonner toast — two channels so the hint
                // can never be hidden behind an overlay/dialog.
                try {
                  window.dispatchEvent(new CustomEvent("nb:back-exit-hint"));
                } catch {}
                try {
                  toast("Press back again to exit", {
                    id: "nb-back-exit-hint", // dedupe rapid presses
                    duration: 1800,
                  });
                } catch {}
              }
              return;
            }

            // 4. Real navigation trail — matches platform expectations
            // ("back = undo my last nav"). Falls back to parent map only when
            // the trail is empty (cold launch / deep link).
            const prevInTrail = history.peekPrevious();
            if (prevInTrail) {
              if (import.meta.env.DEV) console.warn("[back] step=4 trail → history.back()", prevInTrail);
              window.history.back();
              return;
            }

            // 5. Route-aware parent map fallback for deep-links / cold launch.
            const search = new URLSearchParams(window.location.search);
            const target = resolveBackTarget(path, search);
            if (target) {
              nav(target);
              return;
            }

            // 6. Fallback: browser history or dashboard.
            if (canGoBack) {
              window.history.back();
            } else {
              nav("/dashboard", { replace: true });
            }
          });

          removeBackButtonListener = () => { void listener.remove(); };

          // If everything unmounted while we were attaching, remove immediately.
          if (activeHookCount === 0) {
            removeBackButtonListener();
            removeBackButtonListener = null;
          }
        } catch (err) {
          // Cold-start chunk-load race for @capacitor/app is transient and
          // non-fatal — back button still works via the Capacitor bridge's
          // default handler. Only surface in DEV to keep prod logs clean.
          if (import.meta.env.DEV) console.warn("[useAndroidBackButton] setup failed:", err);
        } finally {
          // Clear inside the IIFE so concurrent mounts don't see a null
          // promise while registration is still pending.
          setupPromise = null;
        }
      })();
      return setupPromise;
    };

    void setup();
    return () => {
      activeHookCount = Math.max(0, activeHookCount - 1);
      if (activeHookCount !== 0) return;
      const pending = setupPromise ?? Promise.resolve();
      pending.then(() => {
        if (activeHookCount === 0 && removeBackButtonListener) {
          removeBackButtonListener();
          removeBackButtonListener = null;
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!(EXIT_ROUTES as readonly string[]).includes(location.pathname)) {
      lastBackAt = 0;
    }
  }, [location.pathname]);
};
