import { useEffect, useState } from "react";
import type { CardSaveState } from "../../hooks/useCardModal";

export const SLOW_SAVE_MS = 1000;

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
