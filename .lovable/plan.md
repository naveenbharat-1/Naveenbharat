# Audit: PDF / DPP / Notes Reader Experience

**Current rating: 3.6/5** — Header auto-hides and tap-strip works, but PDF.js toolbar still flashes, no fullscreen, no resume page, no real error state, and no gesture affordances. We can take it to **4.8/5** in one focused pass.

## Scope (files touched)


| File                                                   | Change                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/pdfjs/web/nb-bridge.js`                        | Extend bridge: handle `nb-chrome` (hide/show toolbar), `nb-get-page`, `nb-set-page`; emit `nb-page-change`                                                                          |
| `public/pdfjs/web/viewer.html`                         | Confirm `<script src="nb-bridge.js">` is loaded (already is) — no change unless missing                                                                                             |
| `src/lib/pdfViewerUrl.ts`                              | Add `#pagemode=none&toolbar=0` hash for self-hosted viewer (already set) + helper to re-add `#page=N`                                                                               |
| `src/hooks/useReaderChrome.ts`                         | Reuse — already production-grade; replace the local timer logic inside `DocumentReader` with this hook                                                                              |
| `src/hooks/usePdfResumePosition.ts` *(new)*            | Persist `{lessonId                                                                                                                                                                  |
| `src/components/course/DocumentReader.tsx`             | Major rewrite: postMessage bridge, fullscreen toggle, skeleton + error overlay, swipe gestures                                                                                      |
| `src/components/course/ReaderSkeleton.tsx` *(new)*     | Shimmer skeleton matching reader layout                                                                                                                                             |
| `src/components/course/ReaderErrorOverlay.tsx` *(new)* | Error + Retry + Open-externally                                                                                                                                                     |
| `src/components/video/PdfViewer.tsx`                   | Accept `onReady`, `onPageChange`, `onError`, `initialPage` and forward through to iframe via postMessage; remove the 10s "open external" auto-popup (becomes the new error overlay) |
| `src/pages/LessonView.tsx`                             | Pass `lessonId` to `DocumentReader` for resume key                                                                                                                                  |


## Behavior spec

### 1. PDF.js toolbar sync (postMessage bridge)

- Parent → iframe: `{type:"nb-chrome", visible:boolean}` — bridge toggles `document.getElementById('toolbarContainer').style.transform = visible ? '' : 'translateY(-100%)'` with a 250 ms transition; also hides `#secondaryToolbar` and `#sidebarContainer`.
- Iframe → parent on ready: `{type:"nb-ready"}` so the parent can drop the skeleton.
- Iframe → parent on page change: `{type:"nb-page-change", page:N, total:T}` — bridge subscribes to PDFViewerApplication's `pagechanging` event via `eventBus.on('pagechanging', ...)`.
- Origin check: only accept messages whose `event.source === iframeRef.current.contentWindow`.

### 2. Fullscreen toggle

- Button in the auto-hiding header (Maximize/Minimize icon).
- Uses the standard Fullscreen API on the reader root: `el.requestFullscreen()` / `document.exitFullscreen()`.
- Capacitor Android: when in fullscreen, also call existing `androidImmersive.enter()` helper if present (lazy-import, try/catch).
- ESC + back-button exit handled by existing `useAndroidBackButton` (back closes fullscreen before unmounting reader).

### 3. Resume page / scroll position

- New hook `usePdfResumePosition(key)` returns `{initialPage, savePage}`.
- Key precedence: `lessonId` if available, else hashed `url`.
- Storage: `localStorage["nb:pdf:lastPage"] = JSON.stringify({ [key]: { page, savedAt } })`. Capped at 200 entries (LRU by `savedAt`).
- `savePage` is debounced 800ms to avoid write-storm during fast scroll.
- Restore: parent posts `{type:"nb-set-page", page:N}` once it receives `nb-ready`.

### 4. Loading skeleton + error overlay

- Skeleton: shows immediately on mount, fades out on `nb-ready` (or after iframe `load`, whichever first). Layout = page-shaped rounded blocks with shimmer (uses existing `ui/skeleton`).
- Error overlay triggers on:
  - iframe `error` event
  - 12 s timeout without `nb-ready` AND iframe `load` event already fired but bridge silent → treated as "viewer failed to init"
  - postMessage `{type:"nb-error", reason}`
- Overlay contents: title, message, **Retry** (re-mount iframe with cache-busted `?_=Date.now()`), **Open externally** (existing `openExternal`).

### 5. Swipe gestures (no bottom bar)

- Touch handler on the reader root using a small inline pointer tracker (no extra deps):
  - **Swipe down from top 80px** → show header (and toolbar via bridge).
  - **Swipe up while header visible** → hide header.
  - **Two-finger horizontal swipe** (≥ 80px, < 30° angle) → next/prev page via `{type:"nb-set-page", page:current±1}`. Single-finger horizontal is intentionally ignored to avoid clashing with PDF.js text-selection and pinch-zoom pan.
- All gestures are passive listeners (`{ passive: true }`) to keep scroll smooth.

## Glitch prevention checklist


| #   | Risk                                                     | Mitigation                                                                                                                                      |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Cross-origin postMessage rejected for Drive/Docs branch  | Bridge features are gated to self-hosted `/pdfjs/web/viewer.html` only; Drive/Docs keep current behavior (toolbar hidden via `top:-72px` trick) |
| G2  | `nb-ready` never arrives → skeleton stuck forever        | 12 s fallback resolves to error overlay with Retry                                                                                              |
| G3  | Fullscreen API throws on iOS Safari WebView              | Wrap in try/catch; fall back to existing `useFakeFullscreen` hook already in repo                                                               |
| G4  | localStorage quota / private mode                        | Wrap read+write in try/catch; silently no-op on failure                                                                                         |
| G5  | Resume page restored before viewer finished init         | Defer `nb-set-page` until `nb-ready`; bridge also queues the request if `PDFViewerApplication.initialBookmark` not yet resolved                 |
| G6  | Swipe handler swallowing native pinch-zoom               | Ignore events where `e.touches.length > 2`; only act on `touchend` deltas, never on `touchmove`                                                 |
| G7  | Tap-strip blocks touch-to-scroll near top of PDF         | Keep strip 6px tall only (current is 24px → reduce); already only mounted when chrome hidden                                                    |
| G8  | `key` change on Retry causes screen-protection flash     | Use a `retryNonce` state passed as `iframe.key`; protection hook stays mounted (its parent doesn't unmount)                                     |
| G9  | Header re-show + auto-hide fights with active fullscreen | When `isFullscreen`, set `pinned=false` and `hideAfterMs=1500` for a cleaner cinema feel                                                        |
| G10 | Drive/Docs branch has no `nb-ready` → forever skeleton   | Drive/Docs branch falls back to current `iframe.onLoad` to clear skeleton (bridge features simply disabled)                                     |


## Loop-holes I'm explicitly NOT fixing in this pass

- PDF.js internal sidebar/thumbnails — kept disabled, not exposed.
- Cross-device sync of resume position — local-only for now (server-side would need a Cloud table; out of scope per "presentation only" rule).
- Pinch-zoom gesture customization — relies on PDF.js native behavior.

## Rollout

1. Ship behind no flag (additive UX, no schema change).
2. Manual smoke: open one DPP, one Notes (md), one Drive PDF, one external PDF. Verify: skeleton → ready, header auto-hide, fullscreen toggle, page restore on re-open, swipe down shows header, error overlay on bad URL.
3. Add Maestro step to `maestro/pdf-back.yaml` asserting header hides after 3s.

## Acceptance

- No bottom Prev/Next bar (already removed — kept removed).
- PDF.js toolbar invisible by default, syncs with header.
- Reopening a lesson returns to the last page viewed.
- Failed loads show an actionable overlay with Retry.
- Swipe down anywhere reveals the header; no horizontal single-finger nav.

Used the senior-architect-audit skill.

&nbsp;

Must Use Capicitor skill  
**Progress tracker:**  
- [ ] 1. webapp-to-capacitor  
- [ ] 2. capacitor-best-practices  
- [ ] 3. capacitor-deep-linking  
- [ ] 4. capacitor-keyboard  
- [ ] 5. capacitor-offline-first  
- [ ] 6. capacitor-performance  
- [ ] 7. capacitor-plugins  
- [ ] 8. capacitor-security  
- [ ] 9. capacitor-splash-screen  
- [ ] 10. capacitor-testing  
- [ ] 11. debugging-capacitor  
- [ ] 12. ionic-design  
- [ ] 13. ios-android-logs  
- [ ] 14. safe-area-handling  
- [ ] 15. tailwind-capacitor  
- [ ] 16.capacitor-back-button  
- [ ] 17.asset-optimization  
- [ ] 18.senior-architect-audit  
- [ ] 19.capacitor-video-player-master  
- [  ] 20.app-crash-shield

 -Analysis   
• All Code You Changes and Their work is it worth it ?   
-Rating    
How it Improve Before adter in Term of Speed and Performance and growth   
- find loop hole  
 • What is The Holes  Drawback Of it How to Fix it ?   
Senior level Architect Devloper prompt   
Represented   
koi data analysis Krna ho plan (prompt) ke according TBL format template, comparison kare plan to Excute hua ya nhi insight aayega analysis rating and find loop hool and Senior level Architect Devloper prompt

Now Must Do Open my Website in Browser   
Dont worry about credentials issue it is test phase   
Email :- naveenbharatprism@gmail.com  
password:- Ceoanuj26   
Verify all Implementation   
And Audit is Backbutton logic is Right   
Capacitor Back Button