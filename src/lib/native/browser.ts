/**
 * Open external URLs in the native in-app browser (Chrome Custom Tabs /
 * SFSafariViewController) so the user never leaves the app shell.
 * Falls back to window.open on web.
 */
export const openExternal = async (url: string): Promise<void> => {
  try {
    const { Capacitor } = await import(/* @vite-ignore */ "@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import(/* @vite-ignore */ "@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    }
  } catch { /* fall through */ }
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
};
