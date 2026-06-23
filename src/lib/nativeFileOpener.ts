/**
 * Native-first file opener.
 *
 * Why this exists:
 *   In-app pdf.js viewer renders blank inside Android WebView for many PDFs
 *   (signed Bunny URLs, large files, embedded fonts). Handing the file off
 *   to the OS via `@capacitor-community/file-opener` opens it in the user's
 *   preferred PDF reader (Drive, Adobe, etc.) — 100% reliable.
 *
 * Strategy:
 *   1. Native + already on disk → resolve file:// via Filesystem.getUri, open.
 *   2. Native + only in IndexedDB (web-fallback record) → materialize to Cache.
 *   3. Native + only remote URL → download to Cache, then open.
 *   4. Web → caller falls back to in-app viewer (this fn returns false).
 *
 * Returns true if a native opener was invoked, false to signal fallback.
 */
import type { DownloadRecord } from "./indexedDB";
import { downloadFileDB } from "./indexedDB";

const WEB_LOCAL_PREFIX = "web-indexeddb:";

function parseTaggedPath(localPath: string): { dirName: string; filePath: string } {
  const m = localPath.match(/^(Documents|Data|External|ExternalStorage|Cache|Library):(.+)$/);
  return { dirName: m?.[1] ?? "Data", filePath: m?.[2] ?? localPath };
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    let part = "";
    for (let j = 0; j < slice.length; j += 1) part += String.fromCharCode(slice[j]);
    binary += part;
  }
  return btoa(binary);
}

export async function openFileNative(rec: DownloadRecord): Promise<boolean> {
  let Capacitor: typeof import("@capacitor/core").Capacitor;
  try {
    ({ Capacitor } = await import("@capacitor/core"));
  } catch {
    return false;
  }
  if (!Capacitor.isNativePlatform()) return false;

  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const mime = rec.mime || "application/pdf";

  let fileUri: string | null = null;

  // 1) Already saved natively
  if (rec.local_path && !rec.local_path.startsWith(WEB_LOCAL_PREFIX)) {
    const { dirName, filePath } = parseTaggedPath(rec.local_path);
    const directory =
      (Directory as unknown as Record<string, unknown>)[dirName] ?? Directory.Data;
    try {
      const { uri } = await Filesystem.getUri({ path: filePath, directory: directory as never });
      fileUri = uri;
    } catch (err) {
      console.warn("[openFileNative] getUri failed", err);
    }
  }

  // 2) IndexedDB blob → materialize to Cache
  if (!fileUri && rec.id != null) {
    try {
      const row = await downloadFileDB.get(rec.id);
      if (row?.blob) {
        const buf = new Uint8Array(await row.blob.arrayBuffer());
        const path = `opens/${rec.filename}`;
        await Filesystem.writeFile({
          path,
          data: bytesToBase64(buf),
          directory: Directory.Cache,
          recursive: true,
        });
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
        fileUri = uri;
      }
    } catch (err) {
      console.warn("[openFileNative] IDB materialize failed", err);
    }
  }

  // 3) Remote URL → download to Cache
  if (!fileUri && rec.url && !rec.url.startsWith("blob:")) {
    try {
      const res = await fetch(rec.url, { credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const path = `opens/${rec.filename}`;
      await Filesystem.writeFile({
        path,
        data: bytesToBase64(buf),
        directory: Directory.Cache,
        recursive: true,
      });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      fileUri = uri;
    } catch (err) {
      console.warn("[openFileNative] remote fetch failed", err);
    }
  }

  if (!fileUri) return false;

  try {
    const { FileOpener } = await import("@capacitor-community/file-opener");
    await FileOpener.open({ filePath: fileUri, contentType: mime, openWithDefault: true });
    return true;
  } catch (err) {
    // Common causes:
    //  - FileProvider path not declared in res/xml/file_paths.xml
    //    (IllegalArgumentException: Failed to find configured root...)
    //  - No app installed that can handle the mime type
    //    (ActivityNotFoundException)
    // We log loudly AND return false so the caller's in-app viewer
    // fallback runs instead of leaving the user staring at nothing.
    const msg = (err as Error)?.message || String(err);
    console.error("[openFileNative] FileOpener failed:", msg, { fileUri, mime });
    return false;
  }
}
