import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../lib/convex-api";
import type { ContextMenuSaveState } from "../types/contextMenu";

export interface UseContextMenuSaveResult {
  state: ContextMenuSaveState;
  isRecentSave: boolean;
  clearSave: () => void;
}

const RECENT_SAVE_THRESHOLD = 5000; // 5 seconds

// Track processed saves to prevent duplicates across multiple hook instances
let processedSaves = new Set<string>();

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
    status: 'idle'
  });
  //@ts-ignore
  const createCard = useMutation(api.cards.createCard);

  useEffect(() => {
    // Handle storage changes for context menu saves
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      const maybeSave = changes.contextMenuSave?.newValue;
      if (isContextMenuSaveState(maybeSave)) {
        const newSave = maybeSave;

        // If there's content ready to save, save it (check for duplicates)
        if (newSave.status === 'saving' && newSave.content) {
          const saveId = `${newSave.timestamp}_${newSave.action}`;

          if (!processedSaves.has(saveId)) {
            processedSaves.add(saveId);
            handleSave(newSave.content, newSave.action, saveId);
          } else {
            setContextMenuSave(newSave);
          }
        } else {
          setContextMenuSave(newSave);
        }
      }
    };

    // Set up storage listener first
    chrome.storage.onChanged.addListener(handleStorageChange);

    // Then check for existing state - process saves immediately if found
    chrome.storage.local
      .get<{ contextMenuSave?: ContextMenuSaveState }>("contextMenuSave")
      .then(({ contextMenuSave }) => {
        if (contextMenuSave && isContextMenuSaveState(contextMenuSave)) {
          // Process any pending saves on mount (check for duplicates)
          if (contextMenuSave.status === 'saving' && contextMenuSave.content) {
            const saveId = `${contextMenuSave.timestamp}_${contextMenuSave.action}`;

            if (!processedSaves.has(saveId)) {
              processedSaves.add(saveId);
              handleSave(contextMenuSave.content, contextMenuSave.action, saveId);
            } else {
              setContextMenuSave(contextMenuSave);
            }
          } else {
            setContextMenuSave(contextMenuSave);
          }
        }
      });

    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Save content to Convex
  const handleSave = async (content: string, action?: string, saveId?: string) => {
    if (!content) return;

    // Immediately mark as processing to prevent duplicate saves
    const processingState: ContextMenuSaveState = {
      action: action as any,
      timestamp: Date.now(),
      status: 'saving' // Keep as 'saving' but without content to prevent re-processing
    };

    await chrome.storage.local.set({ contextMenuSave: processingState });
    setContextMenuSave(processingState);

    try {
      await createCard({ content });

      const successState: ContextMenuSaveState = {
        action: action as any,
        timestamp: Date.now(),
        status: 'success'
      };

      await chrome.storage.local.set({ contextMenuSave: successState });
      setContextMenuSave(successState);

      // Clean up processed save ID after success
      if (saveId) {
        // Clean up old entries to prevent memory leak
        setTimeout(() => processedSaves.delete(saveId), RECENT_SAVE_THRESHOLD);
      }

    } catch (error) {

      const errorState: ContextMenuSaveState = {
        action: action as any,
        timestamp: Date.now(),
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to save'
      };

      await chrome.storage.local.set({ contextMenuSave: errorState });
      setContextMenuSave(errorState);

      // Clean up processed save ID after error
      if (saveId) {
        setTimeout(() => processedSaves.delete(saveId), RECENT_SAVE_THRESHOLD);
      }
    }
  };

  // Check if save is recent (within threshold)
  const isRecentSave = contextMenuSave.timestamp &&
    (Date.now() - contextMenuSave.timestamp) < RECENT_SAVE_THRESHOLD;

  // Clear save state
  const clearSave = async () => {
    await chrome.storage.local.remove('contextMenuSave');
    setContextMenuSave({ status: 'idle' });
  };

  return {
    state: contextMenuSave,
    isRecentSave: Boolean(isRecentSave),
    clearSave
  };
};
