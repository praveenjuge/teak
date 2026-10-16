import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useConvex, useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updateCardInSearchQueries } from "./cardQueryOptimisticUpdates";

export type CardWithUrls = Doc<"cards"> & {
  detailUrl?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewMedia?: Array<{
    contentType?: string;
    height?: number;
    posterContentType?: string;
    posterHeight?: number;
    posterUrl?: string;
    posterWidth?: number;
    type: "image" | "video";
    url: string;
    width?: number;
  }>;
  linkPreviewImageUrl?: string;
  hasThumbnailOverride?: true;
};

export type TextField =
  | "content"
  | "url"
  | "notes"
  | "aiSummary"
  | "metadataTitle";

interface PendingChanges {
  aiSummary?: string;
  content?: string;
  isFavorited?: boolean;
  metadataTitle?: string;
  notes?: string;
  url?: string;
}

/** Where the open card's edits stand, for the dialog's save indicator. */
export type CardSaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface CardModalConfig {
  onCardTypeClick?: (cardType: string) => void;
  onCardUpdate?: (card: CardWithUrls) => void;
  onClose?: () => void;
  onError?: (error: Error, operation: string) => void;
  onOpenLink?: (url: string) => void;
  onSuccess?: (message: string) => void;
}

export interface CardModalOptions extends CardModalConfig {
  card?: CardWithUrls | null;
}

/**
 * Edited text fields still to write: changed from the card, and not the
 * value a save already sent (the card may not show it yet).
 */
export function getUnsavedUpdates(
  card: Partial<Record<TextField, string | undefined>>,
  pending: PendingChanges,
  saved: PendingChanges
): { field: TextField; value: string }[] {
  return (Object.keys(pending) as (keyof PendingChanges)[])
    .filter((key): key is TextField => key !== "isFavorited")
    .map((field) => ({ field, value: pending[field] }))
    .filter(
      (update): update is { field: TextField; value: string } =>
        update.value !== undefined &&
        !(update.field === "metadataTitle" && !update.value.trim()) &&
        update.value !== (card[update.field] ?? "") &&
        update.value !== saved[update.field]
    );
}

export function useCardModal(
  cardId: string | null,
  options: CardModalOptions = {}
) {
  const { card: cardData = null, ...config } = options;
  const [tagInput, setTagInput] = useState("");
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [savedValues, setSavedValues] = useState<PendingChanges>({});
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [editsCardId, setEditsCardId] = useState(cardId);

  if (editsCardId !== cardId) {
    setEditsCardId(cardId);
    setPendingChanges({});
    setSavedValues({});
    setTagInput("");
    setIsSaved(false);
    setSaveFailed(false);
  }

  const notifyError = useCallback(
    (error: Error, operation: string) => {
      toast.error(`Failed to ${operation}`);
      config.onError?.(error, operation);
    },
    [config.onError]
  );

  const card = cardData;

  const updateCardField = useMutation(
    api.cards.updateCardField
  ).withOptimisticUpdate((localStore, args) => {
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
        if (!tagToRemove) {
          break;
        }
        const removeAiTag = (card: Doc<"cards">): Doc<"cards"> => {
          const updatedAiTags = card.aiTags?.filter(
            (tag) => tag !== tagToRemove
          );
          return {
            ...card,
            aiTags:
              updatedAiTags && updatedAiTags.length > 0
                ? updatedAiTags
                : undefined,
            updatedAt: now,
          };
        };
        updateCardInSearchQueries(localStore, updateCardId, removeAiTag);
        break;
      }

      case "content":
      case "url":
      case "notes":
      case "metadataTitle":
      case "aiSummary": {
        const updateTextField = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          [field]:
            typeof value === "string" ? value.trim() || undefined : value,
          ...(field === "metadataTitle" ? { metadataTitleEdited: true } : {}),
          updatedAt: now,
        });
        updateCardInSearchQueries(localStore, updateCardId, updateTextField);
        break;
      }

      default:
        break;
    }
  });

  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const convex = useConvex();

  const unsavedUpdates = useMemo(
    () => (card ? getUnsavedUpdates(card, pendingChanges, savedValues) : []),
    [card, pendingChanges, savedValues]
  );

  const hasUnsavedChanges = unsavedUpdates.length > 0;

  useEffect(() => {
    if (!card) {
      return;
    }
    const caughtUp = (Object.keys(savedValues) as TextField[]).filter(
      (field) =>
        savedValues[field] !== undefined &&
        (card[field] ?? "") === savedValues[field]
    );
    if (caughtUp.length === 0) {
      return;
    }
    setSavedValues((prev) => {
      const next = { ...prev };
      for (const field of caughtUp) {
        next[field] = undefined;
      }
      return next;
    });
    setPendingChanges((prev) => {
      const next = { ...prev };
      for (const field of caughtUp) {
        if ((prev[field] ?? "") === (card[field] ?? "")) {
          next[field] = undefined;
        }
      }
      return next;
    });
  }, [card, savedValues]);

  /**
   * Writes every unsaved edit. `silent` skips the toast, for saves that run
   * on their own while someone types. Resolves false when a write failed, so
   * the dialog can stay open instead of dropping the edit.
   */
  const saveChanges = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (!(cardId && unsavedUpdates.length > 0)) {
        return true;
      }
      const updates = unsavedUpdates;
      setIsSaving(true);
      setSaveFailed(false);
      try {
        for (const { field, value } of updates) {
          await updateCardField({
            cardId: cardId as Id<"cards">,
            field,
            value,
          });
          setSavedValues((prev) => ({ ...prev, [field]: value }));
        }
        setIsSaved(true);
        if (!silent) {
          toast.success("Changes saved");
        }
        setTimeout(() => {
          setIsSaved(false);
        }, 2000);
        return true;
      } catch (error) {
        console.error("Failed to save changes:", error);
        setSaveFailed(true);
        notifyError(error as Error, "save changes");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [cardId, unsavedUpdates, updateCardField, notifyError]
  );

  const updateField = useCallback(
    async (
      field: "tags" | "isFavorited" | "removeAiTag",
      value?: boolean | string[],
      tagToRemove?: string
    ) => {
      if (!cardId) {
        return false;
      }

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
            rest.isFavorited = undefined;
            return rest;
          });
        }
        return true;
      } catch (error) {
        console.error(`Failed to update ${field}:`, error);

        if (field === "isFavorited") {
          setPendingChanges((prev) => {
            const rest = { ...prev };
            rest.isFavorited = undefined;
            return rest;
          });
        }

        notifyError(error as Error, `update ${field}`);
        return false;
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

  /** Edits a link's title; undefined drops the edit and keeps the saved one. */
  const updateTitle = useCallback((metadataTitle: string | undefined) => {
    setPendingChanges((prev) => ({ ...prev, metadataTitle }));
  }, []);

  const updateAiSummary = useCallback((summary: string) => {
    setPendingChanges((prev) => ({ ...prev, aiSummary: summary }));
  }, []);

  const toggleFavorite = useCallback(() => {
    if (!card) {
      return;
    }

    const newFavoriteState = !card.isFavorited;
    const previousCard = card;
    const updatedCard = {
      ...card,
      isFavorited: newFavoriteState,
      updatedAt: Date.now(),
    };
    config.onCardUpdate?.(updatedCard);
    setPendingChanges((prev) => ({ ...prev, isFavorited: newFavoriteState }));
    void updateField("isFavorited").then((didUpdate) => {
      if (!didUpdate) {
        config.onCardUpdate?.(previousCard);
      }
    });
  }, [card, config.onCardUpdate, updateField]);

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
      const newTags = currentTags.filter((tag: string) => tag !== tagToRemove);
      void updateField("tags", newTags);
    },
    [card?.tags, updateField]
  );

  const handleDelete = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) {
        return;
      }
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "delete",
        });
        toast.success("Card deleted");
        onClose?.();
      } catch (error) {
        console.error("Failed to delete card:", error);
        toast.error("Failed to delete card");
      }
    },
    [cardId, updateCardField]
  );

  const handleRestore = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) {
        return;
      }
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "restore",
        });
        toast.success("Card restored");
        onClose?.();
      } catch (error) {
        console.error("Failed to restore card:", error);
        toast.error("Failed to restore card");
      }
    },
    [cardId, updateCardField]
  );

  const handlePermanentDelete = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) {
        return;
      }
      try {
        await permanentDeleteCard({ id: cardId as Id<"cards"> });
        toast.success("Card permanently deleted");
        onClose?.();
      } catch (error) {
        console.error("Failed to permanently delete card:", error);
        toast.error("Failed to permanently delete card");
      }
    },
    [cardId, permanentDeleteCard]
  );

  const openLink = useCallback(() => {
    const safeUrl = sanitizeExternalUrl(card?.url);
    if (safeUrl) {
      if (config.onOpenLink) {
        config.onOpenLink(safeUrl);
      } else if (typeof window !== "undefined") {
        window.open(safeUrl, "_blank", "noopener,noreferrer");
      }
    } else if (card?.url) {
      toast.error(
        "This link can't be opened because it uses an unsafe address"
      );
    }
  }, [card?.url, config.onOpenLink]);

  const hasFileObject = Boolean(card?.fileKey);

  const downloadFile = useCallback(async () => {
    if (!(hasFileObject && card?.fileMetadata?.fileName && cardId)) {
      return;
    }

    setIsDownloading(true);
    try {
      // The signed URL asks the files host for `attachment` under the file's
      // name, so the browser streams it to disk instead of this page holding
      // the whole file in memory first.
      const downloadUrl = await convex.query(
        api.card.getFileUrl.getFileDownloadUrl,
        { cardId: cardId as Id<"cards"> }
      );
      if (!downloadUrl) {
        throw new Error("This file isn't available to download");
      }
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Failed to download file:", error);
      notifyError(error as Error, "download file");
    } finally {
      setIsDownloading(false);
    }
  }, [
    hasFileObject,
    card?.fileMetadata?.fileName,
    cardId,
    convex,
    notifyError,
  ]);

  let saveState: CardSaveState = "idle";
  if (isSaving) {
    saveState = "saving";
  } else if (saveFailed) {
    saveState = "error";
  } else if (hasUnsavedChanges) {
    saveState = "unsaved";
  } else if (isSaved) {
    saveState = "saved";
  }

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
    [tagInput, addTag, config.onClose]
  );

  const handleCardTypeClick = useCallback(() => {
    if (card?.type) {
      config.onCardTypeClick?.(card.type);
    }
  }, [card?.type, config.onCardTypeClick]);

  const getCurrentValue = useCallback(
    (field: TextField) =>
      pendingChanges[field] === undefined
        ? card?.[field]
        : pendingChanges[field],
    [card, pendingChanges]
  );

  const cardWithOptimisticUpdates = useMemo(() => {
    if (!card) {
      return null;
    }
    return {
      ...card,
      isFavorited:
        pendingChanges.isFavorited === undefined
          ? card.isFavorited
          : pendingChanges.isFavorited,
    } satisfies CardWithUrls;
  }, [card, pendingChanges.isFavorited]);

  return {
    card: cardWithOptimisticUpdates,
    tagInput,
    setTagInput,
    updateContent,
    updateUrl,
    updateNotes,
    updateTitle,
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
    saveState,
    isDownloading,
  };
}
