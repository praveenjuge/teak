import { useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@teak/convex";
import { type Id } from "@teak/convex/_generated/dataModel";
import { useCardActions } from "./useCardActions";

export interface CardModalConfig {
  onError?: (error: Error, operation: string) => void;
  onOpenLink?: (url: string) => void;
  onClose?: () => void;
}

export function useCardModal(cardId: string | null, config: CardModalConfig = {}) {
  const [tagInput, setTagInput] = useState("");
  
  // Queries
  const card = useQuery(
    api.cards.getCard,
    cardId ? { id: cardId as Id<"cards"> } : "skip"
  );
  
  // Mutations
  const updateCardField = useMutation(api.cards.updateCardField);
  const cardActions = useCardActions(config);
  
  // Update field with automatic error handling
  const updateField = useCallback(async (
    field: "content" | "url" | "notes" | "tags" | "aiSummary" | "isFavorited" | "removeAiTag",
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

  // Specialized update functions
  const updateContent = useCallback((content: string) => {
    updateField("content", content);
  }, [updateField]);

  const updateUrl = useCallback((url: string) => {
    updateField("url", url);
  }, [updateField]);

  const updateNotes = useCallback((notes: string) => {
    updateField("notes", notes);
  }, [updateField]);

  const updateAiSummary = useCallback((summary: string) => {
    updateField("aiSummary", summary);
  }, [updateField]);

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent, onClose?: () => void) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      addTag();
    } else if (e.key === "Escape") {
      onClose?.() || config.onClose?.();
    }
  }, [tagInput, addTag, config]);

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
    handleKeyDown,
  };
}