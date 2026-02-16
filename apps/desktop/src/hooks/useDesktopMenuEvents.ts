import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

interface UseDesktopMenuEventsOptions {
  onLogout: () => void;
  onPreferences: () => void;
}

export function useDesktopMenuEvents({
  onLogout,
  onPreferences,
}: UseDesktopMenuEventsOptions) {
  useEffect(() => {
    let unlistenLogout: (() => void) | null = null;
    let unlistenPreferences: (() => void) | null = null;

    void (async () => {
      unlistenLogout = await listen("desktop://menu/logout", onLogout);
      unlistenPreferences = await listen(
        "desktop://menu/preferences",
        onPreferences
      );
    })();

    return () => {
      if (unlistenLogout) {
        unlistenLogout();
      }
      if (unlistenPreferences) {
        unlistenPreferences();
      }
    };
  }, [onLogout, onPreferences]);
}
