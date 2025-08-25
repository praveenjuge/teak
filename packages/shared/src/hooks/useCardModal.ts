import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@teak/convex";
import { type Id } from "@teak/convex/_generated/dataModel";
import { useCardActions } from "./useCardActions";

export interface CardModalConfig {
  onError?: (error: Error, operation: string) => void;
  onSuccess?: (message: string) => void;
  onOpenLink?: (url: string) => void;
  onClose?: () => void;
}

interface PendingChanges {
  content?: string;
  url?: string;
  notes?: string;
  aiSummary?: string;
}

export function useCardModal(cardId: string | null, config: CardModalConfig = {}) {
  const [tagInput, setTagInput] = useState("");
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [isSaved, setIsSaved] = useState(false);

  // Queries
  const card = useQuery(
    api.cards.getCard,
    cardId ? { id: cardId as Id<"cards"> } : "skip"
  );

  // Mutations
  const updateCardField = useMutation(api.cards.updateCardField);
  const cardActions = useCardActions(config);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!card) return false;
    return Object.keys(pendingChanges).some(key => {
      const pendingValue = pendingChanges[key as keyof PendingChanges];
      const currentValue = card[key as keyof typeof card];
      return pendingValue !== undefined && pendingValue !== currentValue;
    });
  }, [card, pendingChanges]);

  // Save all pending changes
  const saveChanges = useCallback(async () => {
    if (!cardId || !hasUnsavedChanges) return;

    const updates = Object.entries(pendingChanges)
      .filter(([_, value]) => value !== undefined)
      .map(([field, value]) => ({ field, value }));

    // Store current pending changes for error recovery
    const currentPendingChanges = { ...pendingChanges };

    // Optimistic update: immediately clear pending changes and show saved state
    setPendingChanges({});
    setIsSaved(true);

    try {
      // Save all pending changes
      for (const { field, value } of updates) {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: field as "content" | "url" | "notes" | "aiSummary",
          value,
        });
      }

      // Hide the "Saved!" button after 2 seconds
      setTimeout(() => {
        setIsSaved(false);
      }, 2000);

    } catch (error) {
      console.error('Failed to save changes:', error);
      // Restore pending changes on error so save button reappears
      setPendingChanges(currentPendingChanges);
      setIsSaved(false);
      config.onError?.(error as Error, 'save changes');
    }
  }, [cardId, hasUnsavedChanges, pendingChanges, updateCardField, config]);

  // Update field with automatic error handling (for immediate saves like tags/favorites)
  const updateField = useCallback(async (
    field: "tags" | "isFavorited" | "removeAiTag",
    value?: any,
    tagToRemove?: string
  ) => {
    if (!cardId) return;

    try {
      await updateCardField({
        cardId: cardId as Id<"cards">,
        field,
        value,
        tagToRemove,
      });
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      config.onError?.(error as Error, `update ${field}`);
    }
  }, [cardId, updateCardField, config]);

  // Specialized update functions for fields that need local state (pending save)
  const updateContent = useCallback((content: string) => {
    setPendingChanges(prev => ({ ...prev, content }));
  }, []);

  const updateUrl = useCallback((url: string) => {
    setPendingChanges(prev => ({ ...prev, url }));
  }, []);

  const updateNotes = useCallback((notes: string) => {
    setPendingChanges(prev => ({ ...prev, notes }));
  }, []);

  const updateAiSummary = useCallback((summary: string) => {
    setPendingChanges(prev => ({ ...prev, aiSummary: summary }));
  }, []);

  const toggleFavorite = useCallback(() => {
    updateField("isFavorited");
  }, [updateField]);

  const removeAiTag = useCallback((tagToRemove: string) => {
    updateField("removeAiTag", undefined, tagToRemove);
  }, [updateField]);

  // Tag management
  const addTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    const currentTags = card?.tags || [];

    if (tag && !currentTags.includes(tag)) {
      const newTags = [...currentTags, tag];
      setTagInput("");
      updateField("tags", newTags);
    }
  }, [card?.tags, tagInput, updateField]);

  const removeTag = useCallback((tagToRemove: string) => {
    const currentTags = card?.tags || [];
    const newTags = currentTags.filter((tag) => tag !== tagToRemove);
    updateField("tags", newTags);
  }, [card?.tags, updateField]);

  // Action handlers that can optionally close modal
  const handleDelete = useCallback(async (onClose?: () => void) => {
    if (cardId) {
      await cardActions.handleDeleteCard(cardId as Id<"cards">);
      onClose?.() || config.onClose?.();
    }
  }, [cardId, cardActions, config]);

  const handleRestore = useCallback(async (onClose?: () => void) => {
    if (cardId) {
      await cardActions.handleRestoreCard(cardId as Id<"cards">);
      onClose?.() || config.onClose?.();
    }
  }, [cardId, cardActions, config]);

  const handlePermanentDelete = useCallback(async (onClose?: () => void) => {
    if (cardId) {
      await cardActions.handlePermanentDeleteCard(cardId as Id<"cards">);
      onClose?.() || config.onClose?.();
    }
  }, [cardId, cardActions, config]);

  // Utility functions
  const openLink = useCallback(() => {
    if (card?.url) {
      config.onOpenLink?.(card.url);
    }
  }, [card?.url, config]);

  // Get file URL for download
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card?.fileId ? { fileId: card.fileId, cardId: cardId as Id<"cards"> } : "skip"
  );

  const downloadFile = useCallback(async () => {
    if (!card?.fileId || !card?.fileMetadata?.fileName || !fileUrl) return;

    try {
      // Create a temporary anchor element to trigger download
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = card.fileMetadata.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to download file:', error);
      config.onError?.(error as Error, 'download file');
    }
  }, [card?.fileId, card?.fileMetadata?.fileName, fileUrl, config]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, onClose?: () => void) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      addTag();
    } else if (e.key === "Escape") {
      onClose?.() || config.onClose?.();
    }
  }, [tagInput, addTag, config]);

  // Get the current value for form fields (pending changes take priority)
  const getCurrentValue = useCallback((field: keyof PendingChanges) => {
    return pendingChanges[field] !== undefined ? pendingChanges[field] : card?.[field];
  }, [card, pendingChanges]);

  return {
    // State
    card,
    tagInput,
    setTagInput,

    // Field updates
    updateContent,
    updateUrl,
    updateNotes,
    updateAiSummary,
    toggleFavorite,
    removeAiTag,

    // Tag management
    addTag,
    removeTag,

    // Actions
    handleDelete,
    handleRestore,
    handlePermanentDelete,

    // Utilities
    openLink,
    downloadFile,
    handleKeyDown,

    // Save functionality
    saveChanges,
    hasUnsavedChanges,
    getCurrentValue,
    isSaved,
  };
}