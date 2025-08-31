import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import type { ContextMenuSaveState } from "../types/contextMenu";

export interface UseContextMenuSaveResult {
  state: ContextMenuSaveState;
  isRecentSave: boolean;
  clearSave: () => void;
}

const RECENT_SAVE_THRESHOLD = 5000; // 5 seconds

// Track processed saves to prevent duplicates across multiple hook instances
let processedSaves = new Set<string>();

export const useContextMenuSave = (): UseContextMenuSaveResult => {
  const [contextMenuSave, setContextMenuSave] = useState<ContextMenuSaveState>({
    status: 'idle'
  });
  
  const createCard = useMutation(api.cards.createCard);

  useEffect(() => {
    // Handle storage changes for context menu saves
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.contextMenuSave?.newValue) {
        const newSave = changes.contextMenuSave.newValue;
        console.log('Context menu hook: Storage changed', newSave);
        
        // If there's content ready to save, save it (check for duplicates)
        if (newSave.status === 'saving' && newSave.content) {
          const saveId = `${newSave.timestamp}_${newSave.action}`;
          
          if (!processedSaves.has(saveId)) {
            console.log('Context menu hook: Saving content for', newSave.action);
            processedSaves.add(saveId);
            handleSave(newSave.content, newSave.action, saveId);
          } else {
            console.log('Context menu hook: Save already processed, skipping duplicate');
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
    chrome.storage.local.get('contextMenuSave').then((result) => {
      if (result.contextMenuSave) {
        console.log('Context menu hook: Found existing state on mount', result.contextMenuSave);
        
        // Process any pending saves on mount (check for duplicates)
        if (result.contextMenuSave.status === 'saving' && result.contextMenuSave.content) {
          const saveId = `${result.contextMenuSave.timestamp}_${result.contextMenuSave.action}`;
          
          if (!processedSaves.has(saveId)) {
            console.log('Context menu hook: Processing pending save on mount');
            processedSaves.add(saveId);
            handleSave(result.contextMenuSave.content, result.contextMenuSave.action, saveId);
          } else {
            console.log('Context menu hook: Save already processed, skipping duplicate');
            setContextMenuSave(result.contextMenuSave);
          }
        } else {
          setContextMenuSave(result.contextMenuSave);
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
      console.error('Context menu save error:', error);
      
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