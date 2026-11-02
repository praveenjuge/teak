import { useEffect, useEffectEvent } from "react";

/**
 * While `active`, asks before the tab closes or reloads. `onLeave` runs as
 * the prompt opens, so the pending write is on its way whichever button the
 * user picks, and when the tab is hidden, the last moment a phone that
 * discards the tab without a prompt still lets it run.
 */
export function useWarnBeforeUnload(active: boolean, onLeave?: () => void) {
  // Reads the latest callback when the page goes, so a callback that changes
  // with every keystroke doesn't take the listeners down and up each time.
  const leave = useEffectEvent(() => onLeave?.());
  useEffect(() => {
    if (!active) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      leave();
      event.preventDefault();
      // Older Chrome and Safari need returnValue set to show the prompt.
      event.returnValue = "";
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        leave();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active]);
}
