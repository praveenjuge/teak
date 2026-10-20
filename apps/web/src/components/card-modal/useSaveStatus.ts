import { useEffect, useState } from "react";
import type { CardSaveState } from "../../hooks/useCardModal";

/** A save that takes longer than this shows "Saving…". */
export const SLOW_SAVE_MS = 1000;

/**
 * Which save state is worth showing. Autosave runs all the time, so the
 * dialog stays quiet: a failure always shows, "Saving…" only once a save is
 * slow, and "Saved" for the moment `useCardModal` reports it.
 */
export function useSaveStatus(
  saveState: CardSaveState
): Extract<CardSaveState, "saving" | "saved" | "error"> | null {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    setIsSlow(false);
    if (saveState !== "saving") {
      return;
    }
    const timer = window.setTimeout(() => setIsSlow(true), SLOW_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  if (saveState === "saving") {
    return isSlow ? "saving" : null;
  }
  if (saveState === "error" || saveState === "saved") {
    return saveState;
  }
  return null;
}
