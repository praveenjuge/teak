import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

interface UseDesktopMenuEventsOptions {
  onCheckForUpdates: () => void;
  onLogout: () => void;
  onSettings: () => void;
}

export function useDesktopMenuEvents({
  onLogout,
  onSettings,
  onCheckForUpdates,
}: UseDesktopMenuEventsOptions) {
  useEffect(() => {
    let unlistenLogout: (() => void) | null = null;
    let unlistenSettings: (() => void) | null = null;
    let unlistenCheckForUpdates: (() => void) | null = null;

    void (async () => {
      unlistenLogout = await listen("desktop://menu/logout", onLogout);
      unlistenSettings = await listen("desktop://menu/settings", onSettings);
      unlistenCheckForUpdates = await listen(
        "desktop://menu/check-for-updates",
        onCheckForUpdates
      );
    })();

    return () => {
      if (unlistenLogout) {
        unlistenLogout();
      }
      if (unlistenSettings) {
        unlistenSettings();
      }
      if (unlistenCheckForUpdates) {
        unlistenCheckForUpdates();
      }
    };
  }, [onLogout, onSettings, onCheckForUpdates]);
}
