import { useEffect, useState } from "react";
import {
  type ContextMenuSaveState,
  RECENT_CONTEXT_MENU_SAVE_MS,
} from "../types/contextMenu";

export interface UseContextMenuSaveResult {
  clearSave: () => void;
  isRecentSave: boolean;
  state: ContextMenuSaveState;
}

const isContextMenuSaveState = (
  value: unknown
): value is ContextMenuSaveState =>
  Boolean(
    value &&
      typeof value === "object" &&
      "status" in (value as ContextMenuSaveState)
  );

export const useContextMenuSave = (): UseContextMenuSaveResult => {
  const [contextMenuSave, setContextMenuSave] = useState<ContextMenuSaveState>({
    status: "idle",
  });
  const [isRecentSave, setIsRecentSave] = useState(false);

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      const maybeSave = changes.contextMenuSave?.newValue;
      if (isContextMenuSaveState(maybeSave)) {
        setContextMenuSave(maybeSave);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    void chrome.storage.local
      .get<{ contextMenuSave?: ContextMenuSaveState }>("contextMenuSave")
      .then(({ contextMenuSave }) => {
        if (contextMenuSave && isContextMenuSaveState(contextMenuSave)) {
          setContextMenuSave(contextMenuSave);
        }
      });

    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (
      contextMenuSave.timestamp &&
      Date.now() - contextMenuSave.timestamp < RECENT_CONTEXT_MENU_SAVE_MS
    ) {
      setIsRecentSave(true);
    }
  }, [contextMenuSave.timestamp]);

  const clearSave = async () => {
    await chrome.storage.local.remove("contextMenuSave");
    setContextMenuSave({ status: "idle" });
  };

  return {
    state: contextMenuSave,
    isRecentSave,
    clearSave,
  };
};
