import { useEffect } from "react";

interface UseDesktopMenuEventsOptions {
  onLogout: () => void;
  onSettings: () => void;
}

export function useDesktopMenuEvents({
  onLogout,
  onSettings,
}: UseDesktopMenuEventsOptions) {
  useEffect(() => {
    const unlistenLogout = window.teakDesktop.onMenuEvent(
      "desktop://menu/logout",
      onLogout
    );
    const unlistenSettings = window.teakDesktop.onMenuEvent(
      "desktop://menu/settings",
      onSettings
    );

    return () => {
      unlistenLogout();
      unlistenSettings();
    };
  }, [onLogout, onSettings]);
}
