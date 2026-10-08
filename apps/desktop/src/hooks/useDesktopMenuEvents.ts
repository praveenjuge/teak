import { useEffect } from "react";

interface UseDesktopMenuEventsOptions {
  onSettings: () => void;
}

export function useDesktopMenuEvents({
  onSettings,
}: UseDesktopMenuEventsOptions) {
  useEffect(
    () => window.teakDesktop.onMenuEvent("desktop://menu/settings", onSettings),
    [onSettings]
  );
}
