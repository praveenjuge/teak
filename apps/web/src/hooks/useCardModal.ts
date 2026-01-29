import { useState, useCallback, useMemo } from "react";
import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { toast } from "sonner";
import { api } from "@teak/convex";
import { type Doc, type Id } from "@teak/convex/_generated/dataModel";
import { useCardActions } from "@/hooks/useCardActions";
import * as Sentry from "@sentry/nextjs";
import { metrics } from "@/lib/metrics";

// Helper to update a card in all cached searchCards queries
function updateCardInSearchQueries(
  localStore: OptimisticLocalStore,
  cardId: Id<"cards">,
  updater: (card: Doc<"cards">) => Doc<"cards">
) {
  const allQueries = localStore.getAllQueries(api.cards.searchCards);
  for (const { args, value } of allQueries) {
    if (value !== undefined) {
      const updatedCards = (value as Doc<"cards">[]).map((card: Doc<"cards">) =>
        card._id === cardId ? updater(card) : card
      );
      localStore.setQuery(api.cards.searchCards, args, updatedCards);
    }
  }
}

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

interface PendingChanges {
  content?: string;
  url?: string;
  notes?: string;
  aiSummary?: string;
  isFavorited?: boolean;
}

export interface CardModalConfig {
  onError?: (error: Error, operation: string) => void;
  onSuccess?: (message: string) => void;
  onOpenLink?: (url: string) => void;
  onClose?: () => void;
  onCardTypeClick?: (cardType: string) => void;
}

export interface CardModalOptions extends CardModalConfig {
  card?: CardWithUrls | null;
}

export function useCardModal(
  cardId: string | null,
  options: CardModalOptions = {}
) {
  const { card: cardData = null, ...config } = options;
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

  const card = cardData;

  const updateCardField = useMutation(api.cards.updateCardField).withOptimisticUpdate(
    (localStore, args) => {
      const { cardId: updateCardId, field, value, tagToRemove } = args;
       
      const now = Date.now();

      switch (field) {
        case "isFavorited": {
          const toggleFavorite = (card: Doc<"cards">): Doc<"cards"> => ({
            ...card,
            isFavorited: !card.isFavorited,
            updatedAt: now,
          });
          updateCardInSearchQueries(localStore, updateCardId, toggleFavorite);
          break;
        }

        case "tags": {
          const updateTags = (card: Doc<"cards">): Doc<"cards"> => ({
            ...card,
            tags: Array.isArray(value) && value.length > 0 ? value : undefined,
            updatedAt: now,
          });
          updateCardInSearchQueries(localStore, updateCardId, updateTags);
          break;
        }

        case "removeAiTag": {
          if (!tagToRemove) break;
          const removeAiTag = (card: Doc<"cards">): Doc<"cards"> => {
            const updatedAiTags = card.aiTags?.filter((tag) => tag !== tagToRemove);
            return {
              ...card,
              aiTags: updatedAiTags && updatedAiTags.length > 0 ? updatedAiTags : undefined,
              updatedAt: now,
            };
          };
          updateCardInSearchQueries(localStore, updateCardId, removeAiTag);
          break;
        }

        case "content":
        case "url":
        case "notes":
        case "aiSummary": {
          const updateTextField = (card: Doc<"cards">): Doc<"cards"> => ({
            ...card,
            [field]: typeof value === "string" ? value.trim() || undefined : value,
            updatedAt: now,
          });
          updateCardInSearchQueries(localStore, updateCardId, updateTextField);
          break;
        }
      }
    }
  );
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
      .filter(([, value]) => value !== undefined)
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
      Sentry.captureException(error, {
        tags: { source: "convex", mutation: "cards:updateCardField" },
        extra: { cardId, fields: Object.keys(currentPendingChanges) },
      });
      setPendingChanges(currentPendingChanges);
      setIsSaved(false);
      notifyError(error as Error, "save changes");
    }
  }, [cardId, hasUnsavedChanges, pendingChanges, updateCardField, notifyError]);

  const updateField = useCallback(
    async (
      field: "tags" | "isFavorited" | "removeAiTag",
      value?: boolean | string[],
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
            const rest = { ...prev };
            delete rest.isFavorited;
            return rest;
          });
        }
      } catch (error) {
        console.error(`Failed to update ${field}:`, error);
        Sentry.captureException(error, {
          tags: { source: "convex", mutation: "cards:updateCardField" },
          extra: { cardId, field },
        });

        if (field === "isFavorited") {
          setPendingChanges((prev) => {
            const rest = { ...prev };
            delete rest.isFavorited;
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
      metrics.tagRemoved("ai");
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
      metrics.tagAdded("user");
      void updateField("tags", newTags);
    }
  }, [card?.tags, tagInput, updateField]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      const currentTags = card?.tags || [];
      const newTags = currentTags.filter((tag: string) => tag !== tagToRemove);
      metrics.tagRemoved("user");
      void updateField("tags", newTags);
    },
    [card?.tags, updateField]
  );

  const handleDelete = useCallback(
    async (onClose?: () => void) => {
      if (cardId) {
        await cardActions.handleDeleteCard(cardId as Id<"cards">);
        if (onClose) {
          onClose();
        } else {
          config.onClose?.();
        }
      }
    },
    [cardId, cardActions, config]
  );

  const handleRestore = useCallback(
    async (onClose?: () => void) => {
      if (cardId) {
        await cardActions.handleRestoreCard(cardId as Id<"cards">);
        if (onClose) {
          onClose();
        } else {
          config.onClose?.();
        }
      }
    },
    [cardId, cardActions, config]
  );

  const handlePermanentDelete = useCallback(
    async (onClose?: () => void) => {
      if (cardId) {
        await cardActions.handlePermanentDeleteCard(cardId as Id<"cards">);
        if (onClose) {
          onClose();
        } else {
          config.onClose?.();
        }
      }
    },
    [cardId, cardActions, config]
  );


  const openLink = useCallback(() => {
    if (card?.url) {
      metrics.linkOpened(card.type);
      metrics.featureUsed("open_link");
      if (config.onOpenLink) {
        config.onOpenLink(card.url);
      } else if (typeof window !== "undefined") {
        window.open(card.url, "_blank", "noopener,noreferrer");
      }
    }
  }, [card?.url, card?.type, config]);

  const fileUrl = card?.fileUrl;


  const downloadFile = useCallback(async () => {
    if (!card?.fileId || !card?.fileMetadata?.fileName || !fileUrl) return;

    try {
      metrics.fileDownloaded(card.type, card.fileMetadata?.mimeType?.split("/")[0] || "unknown");
      metrics.featureUsed("download_file");

      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = card.fileMetadata.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Failed to download file:", error);
      Sentry.captureException(error, {
        tags: { source: "client", operation: "downloadFile" },
        extra: { cardId, fileName: card?.fileMetadata?.fileName },
      });
      notifyError(error as Error, "download file");
    }
  }, [card?.fileId, card?.fileMetadata?.fileName, card?.fileMetadata?.mimeType, card?.type, fileUrl, notifyError, cardId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, onClose?: () => void) => {
      if (e.key === "Enter" && tagInput.trim()) {
        e.preventDefault();
        addTag();
      } else if (e.key === "Escape") {
        if (onClose) {
          onClose();
        } else {
          config.onClose?.();
        }
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
    } satisfies CardWithUrls;
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
