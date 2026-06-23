// Naveen Bharat — Native debug helpers.
//
// Pipes unhandled JS errors to native logcat / Xcode console so APK builds in
// the wild can be debugged via `adb logcat | grep Capacitor` without USB
// devtools attached. Visit any route with `?debug=1` to show an in-app
// overlay with the last 50 console lines — invaluable for QA on physical
// devices.

interface ConsoleLine {
  level: "log" | "warn" | "error";
  ts: number;
  msg: string;
}

const buffer: ConsoleLine[] = [];
const MAX_LINES = 50;

function pushLine(level: ConsoleLine["level"], args: unknown[]) {
  try {
    const msg = args
      .map((a) =>
        typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
      )
      .join(" ");
    buffer.push({ level, ts: Date.now(), msg: msg.slice(0, 500) });
    if (buffer.length > MAX_LINES) buffer.shift();
    renderOverlayIfVisible();
  } catch {
    // ignore
  }
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

let overlayEl: HTMLDivElement | null = null;
function renderOverlayIfVisible() {
  if (!overlayEl) return;
  overlayEl.innerHTML = buffer
    .slice()
    .reverse()
    .map(
      (l) =>
        `<div style="color:${l.level === "error" ? "#ff6b6b" : l.level === "warn" ? "#ffd166" : "#a8dadc"};margin-bottom:4px"><span style="opacity:.6">${fmtTime(l.ts)}</span> ${escapeHtml(l.msg)}</div>`
    )
    .join("");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mountOverlay() {
  if (overlayEl || typeof document === "undefined") return;
  overlayEl = document.createElement("div");
  overlayEl.id = "nb-debug-overlay";
  overlayEl.setAttribute("aria-label", "Debug console");
  Object.assign(overlayEl.style, {
    position: "fixed",
    left: "8px",
    right: "8px",
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
    maxHeight: "40vh",
    overflowY: "auto",
    background: "rgba(0,0,0,0.85)",
    color: "#fff",
    font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "8px 10px",
    borderRadius: "8px",
    zIndex: "2147483647",
    pointerEvents: "auto",
    backdropFilter: "blur(4px)",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlayEl);
  renderOverlayIfVisible();
}

export function initNativeDebug(): void {
  if (typeof window === "undefined") return;

  // Wrap console methods (capture for overlay; native bridges still relay to
  // logcat / Xcode console automatically).
  (["log", "warn", "error"] as const).forEach((k) => {
    const orig = console[k].bind(console);
    console[k] = (...args: unknown[]) => {
      pushLine(k, args);
      orig(...args);
    };
  });

  window.addEventListener("error", (e) => {
    console.error("[window.error]", e.message, e.filename, e.lineno);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[unhandledrejection]", (e.reason && (e.reason.stack || e.reason.message)) || e.reason);
  });

  try {
    const debugOn = new URLSearchParams(window.location.search).has("debug");
    if (debugOn) mountOverlay();
  } catch {
    // ignore
  }
}
