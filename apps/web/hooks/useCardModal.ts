import { useState, useCallback, useMemo } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { api } from "@teak/convex";
import { type Id } from "@teak/convex/_generated/dataModel";
import { useCardActions } from "@/hooks/useCardActions";

export interface CardModalConfig {
  onError?: (error: Error, operation: string) => void;
  onSuccess?: (message: string) => void;
  onOpenLink?: (url: string) => void;
  onClose?: () => void;
  onCardTypeClick?: (cardType: string) => void;
}

interface PendingChanges {
  content?: string;
  url?: string;
  notes?: string;
  aiSummary?: string;
  isFavorited?: boolean;
}

export function useCardModal(
  cardId: string | null,
  config: CardModalConfig = {}
) {
  const [tagInput, setTagInput] = useState("");
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [isSaved, setIsSaved] = useState(false);

  const notifyError = useCallback(
    (error: Error, operation: string) => {
      toast.error(`Failed to ${operation}`);
      config.onError?.(error, operation);
    },
    [config]
  );

  const card = useQuery(
    api.cards.getCard,
    cardId ? { id: cardId as Id<"cards"> } : "skip"
  );

  const updateCardField = useMutation(api.cards.updateCardField);
  const cardActions = useCardActions({
    onDeleteSuccess: (message) => {
      if (message) {
        toast(message);
        config.onSuccess?.(message);
      }
    },
    onRestoreSuccess: (message) => {
      if (message) {
        toast(message);
        config.onSuccess?.(message);
      }
    },
    onPermanentDeleteSuccess: (message) => {
      if (message) {
        toast(message);
        config.onSuccess?.(message);
      }
    },
    onError: notifyError,
  });

  const hasUnsavedChanges = useMemo(() => {
    if (!card) return false;
    return Object.keys(pendingChanges).some((key) => {
      if (key === "isFavorited") return false;

      const pendingValue = pendingChanges[key as keyof PendingChanges];
      const currentValue = card[key as keyof typeof card];
      return pendingValue !== undefined && pendingValue !== currentValue;
    });
  }, [card, pendingChanges]);

  const saveChanges = useCallback(async () => {
    if (!cardId || !hasUnsavedChanges) return;

    const updates = Object.entries(pendingChanges)
      .filter(([_, value]) => value !== undefined)
      .map(([field, value]) => ({ field, value }));

    const currentPendingChanges = { ...pendingChanges };

    setPendingChanges({});
    setIsSaved(true);

    try {
      for (const { field, value } of updates) {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: field as "content" | "url" | "notes" | "aiSummary",
          value,
        });
      }

      setTimeout(() => {
        setIsSaved(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to save changes:", error);
      setPendingChanges(currentPendingChanges);
      setIsSaved(false);
      notifyError(error as Error, "save changes");
    }
  }, [cardId, hasUnsavedChanges, pendingChanges, updateCardField, notifyError]);

  const updateField = useCallback(
    async (
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

        if (field === "isFavorited") {
          setPendingChanges((prev) => {
            const { isFavorited, ...rest } = prev;
            return rest;
          });
        }
      } catch (error) {
        console.error(`Failed to update ${field}:`, error);

        if (field === "isFavorited") {
          setPendingChanges((prev) => {
            const { isFavorited, ...rest } = prev;
            return rest;
          });
        }

        notifyError(error as Error, `update ${field}`);
      }
    },
    [cardId, updateCardField, notifyError]
  );

  const updateContent = useCallback((content: string) => {
    setPendingChanges((prev) => ({ ...prev, content }));
  }, []);

  const updateUrl = useCallback((url: string) => {
    setPendingChanges((prev) => ({ ...prev, url }));
  }, []);

  const updateNotes = useCallback((notes: string) => {
    setPendingChanges((prev) => ({ ...prev, notes }));
  }, []);

  const updateAiSummary = useCallback((summary: string) => {
    setPendingChanges((prev) => ({ ...prev, aiSummary: summary }));
  }, []);

  const toggleFavorite = useCallback(() => {
    if (!card) return;

    const newFavoriteState = !card.isFavorited;
    setPendingChanges((prev) => ({ ...prev, isFavorited: newFavoriteState }));
    void updateField("isFavorited");
  }, [card, updateField]);

  const removeAiTag = useCallback(
    (tagToRemove: string) => {
      void updateField("removeAiTag", undefined, tagToRemove);
    },
    [updateField]
  );

  const addTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    const currentTags = card?.tags || [];

    if (tag && !currentTags.includes(tag)) {
      const newTags = [...currentTags, tag];
      setTagInput("");
      void updateField("tags", newTags);
    }
  }, [card?.tags, tagInput, updateField]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      const currentTags = card?.tags || [];
      const newTags = currentTags.filter((tag) => tag !== tagToRemove);
      void updateField("tags", newTags);
    },
    [card?.tags, updateField]
  );

  const handleDelete = useCallback(
    async (onClose?: () => void) => {
      if (cardId) {
        await cardActions.handleDeleteCard(cardId as Id<"cards">);
        onClose?.() || config.onClose?.();
      }
    },
    [cardId, cardActions, config]
  );

  const handleRestore = useCallback(
    async (onClose?: () => void) => {
      if (cardId) {
        await cardActions.handleRestoreCard(cardId as Id<"cards">);
        onClose?.() || config.onClose?.();
      }
    },
    [cardId, cardActions, config]
  );

  const handlePermanentDelete = useCallback(
    async (onClose?: () => void) => {
      if (cardId) {
        await cardActions.handlePermanentDeleteCard(cardId as Id<"cards">);
        onClose?.() || config.onClose?.();
      }
    },
    [cardId, cardActions, config]
  );

  const openLink = useCallback(() => {
    if (card?.url) {
      if (config.onOpenLink) {
        config.onOpenLink(card.url);
      } else if (typeof window !== "undefined") {
        window.open(card.url, "_blank", "noopener,noreferrer");
      }
    }
  }, [card?.url, config]);

  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card?.fileId
      ? { fileId: card.fileId, cardId: cardId as Id<"cards"> }
      : "skip"
  );

  const downloadFile = useCallback(async () => {
    if (!card?.fileId || !card?.fileMetadata?.fileName || !fileUrl) return;

    try {
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = card.fileMetadata.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Failed to download file:", error);
      notifyError(error as Error, "download file");
    }
  }, [card?.fileId, card?.fileMetadata?.fileName, fileUrl, notifyError]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, onClose?: () => void) => {
      if (e.key === "Enter" && tagInput.trim()) {
        e.preventDefault();
        addTag();
      } else if (e.key === "Escape") {
        onClose?.() || config.onClose?.();
      }
    },
    [tagInput, addTag, config]
  );

  const handleCardTypeClick = useCallback(() => {
    if (card?.type) {
      config.onCardTypeClick?.(card.type);
    }
  }, [card?.type, config]);

  const getCurrentValue = useCallback(
    (field: "content" | "url" | "notes" | "aiSummary") => {
      return pendingChanges[field] !== undefined
        ? pendingChanges[field]
        : card?.[field];
    },
    [card, pendingChanges]
  );

  const cardWithOptimisticUpdates = useMemo(() => {
    if (!card) return null;
    return {
      ...card,
      isFavorited:
        pendingChanges.isFavorited !== undefined
          ? pendingChanges.isFavorited
          : card.isFavorited,
    };
  }, [card, pendingChanges.isFavorited]);

  return {
    card: cardWithOptimisticUpdates,
    tagInput,
    setTagInput,
    updateContent,
    updateUrl,
    updateNotes,
    updateAiSummary,
    toggleFavorite,
    removeAiTag,
    addTag,
    removeTag,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    openLink,
    downloadFile,
    handleKeyDown,
    handleCardTypeClick,
    saveChanges,
    hasUnsavedChanges,
    getCurrentValue,
    isSaved,
  };
}
