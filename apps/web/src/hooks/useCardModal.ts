import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import {
  explainInvalidCardTags,
  isCardHidden,
  isHiddenTagList,
} from "@teak/convex/shared/tags";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import { useConvex, useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
import { updateCardInSearchQueries } from "../lib/cardQueryOptimisticUpdates";
import { openCardLink } from "../lib/openCardLink";
import { cardActionFailedMessage } from "./cardActions";
import { useServerErrors } from "./useServerErrors";
import { useWarnBeforeUnload } from "./useWarnBeforeUnload";

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
 * A note or quote with nothing in it isn't saved, as the composer won't
 * create one: the card keeps the content it last saved.
 */
const isBlankRequiredField = (field: TextField, value: string) =>
  (field === "metadataTitle" || field === "content") && !value.trim();

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
        !isBlankRequiredField(update.field, update.value) &&
        update.value !== (card[update.field] ?? "") &&
        update.value !== saved[update.field]
    );
}

/** Tags compare as the server stores them: trimmed, ignoring case. */
const tagKey = (tag: string) => tag.trim().toLowerCase();

export function useCardModal(
  cardId: string | null,
  options: CardModalOptions = {}
) {
  const { card: cardData = null, ...config } = options;
  const t = useTranslations("hooks.cardActions");
  const tc = useTranslations("common");
  const serverErrors = useServerErrors();
  const [tagInput, setTagInput] = useState("");
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [savedValues, setSavedValues] = useState<PendingChanges>({});
  const [isSaved, setIsSaved] = useState(false);
  // Saves still in flight, for this card or one left meanwhile.
  const [savesInFlight, setSavesInFlight] = useState(0);
  const isSaving = savesInFlight > 0;
  const [saveFailed, setSaveFailed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [editsCardId, setEditsCardId] = useState(cardId);
  const [pendingDone, setPendingDone] = useState<Record<string, boolean>>({});
  const doneInFlight = useRef(new Set<string>());

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
      toast.error(cardActionFailedMessage(operation, t));
      config.onError?.(error, operation);
    },
    [config.onError, t]
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

      case "done":
      case "undone": {
        const setDone = (card: Doc<"cards">): Doc<"cards"> =>
          card.type === "link"
            ? {
                ...card,
                completedAt:
                  field === "done" ? (card.completedAt ?? now) : undefined,
                updatedAt: now,
              }
            : card;
        updateCardInSearchQueries(localStore, updateCardId, setDone);
        break;
      }

      case "tags": {
        const tags =
          Array.isArray(value) && value.length > 0 ? value : undefined;
        const updateTags = (card: Doc<"cards">): Doc<"cards"> => ({
          ...card,
          tags,
          isHidden: isHiddenTagList(tags) ? true : undefined,
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

  // The card open after the latest commit, so a save or delete that
  // finishes after the user moved on doesn't touch the card open now.
  const openCardIdRef = useRef(cardId);
  const latestEditsRef = useRef({ cardId, updates: unsavedUpdates });
  useEffect(() => {
    openCardIdRef.current = cardId;
    latestEditsRef.current = { cardId, updates: unsavedUpdates };
  }, [cardId, unsavedUpdates]);

  // Every way off a card (a tag or type link, Back, a swipe, the dialog
  // unmounting) resets the edits above, so whatever wasn't saved yet is
  // sent now rather than dropped. Saving first, as the arrows and Close
  // do, leaves nothing here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cleanup must run when the open card changes, and its calls work for any card
  useEffect(
    () => () => {
      const { cardId: leftCardId, updates } = latestEditsRef.current;
      if (!leftCardId || updates.length === 0) {
        return;
      }
      // Each field is sent on its own, so one refused field doesn't drop
      // the others.
      for (const { field, value } of updates) {
        setSavesInFlight((count) => count + 1);
        updateCardField({
          cardId: leftCardId as Id<"cards">,
          field,
          value,
        })
          .catch((error) => notifyError(error as Error, "save changes"))
          .finally(() => setSavesInFlight((count) => count - 1));
      }
    },
    [cardId]
  );

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

  const saveChanges = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
      if (!(cardId && unsavedUpdates.length > 0)) {
        return true;
      }
      const updates = unsavedUpdates;
      const isStillOpen = () => openCardIdRef.current === cardId;
      setSavesInFlight((count) => count + 1);
      setSaveFailed(false);
      try {
        for (const { field, value } of updates) {
          await updateCardField({
            cardId: cardId as Id<"cards">,
            field,
            value,
          });
          if (isStillOpen()) {
            setSavedValues((prev) => ({ ...prev, [field]: value }));
          }
        }
        if (!isStillOpen()) {
          return true;
        }
        setIsSaved(true);
        if (!silent) {
          toast.success(t("changesSaved"));
        }
        setTimeout(() => {
          setIsSaved(false);
        }, 2000);
        return true;
      } catch (error) {
        console.error("Failed to save changes:", error);
        if (isStillOpen()) {
          setSaveFailed(true);
        }
        notifyError(error as Error, "save changes");
        return false;
      } finally {
        setSavesInFlight((count) => count - 1);
      }
    },
    [cardId, unsavedUpdates, updateCardField, notifyError, t]
  );

  const saveBeforeLeaving = useCallback(() => {
    void saveChanges({ silent: true });
  }, [saveChanges]);
  useWarnBeforeUnload(hasUnsavedChanges || isSaving, saveBeforeLeaving);

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
        return true;
      } catch (error) {
        console.error(`Failed to update ${field}:`, error);
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

  const updateTitle = useCallback((metadataTitle: string | undefined) => {
    setPendingChanges((prev) => ({ ...prev, metadataTitle }));
  }, []);

  const updateAiSummary = useCallback((summary: string) => {
    setPendingChanges((prev) => ({ ...prev, aiSummary: summary }));
  }, []);

  // The state on screen, which a quick second press toggles from. Each press
  // toggles on the server too, so the shown state holds until every press
  // in flight has settled, rather than flicking back as the first one does.
  const shownFavorite = useRef<boolean | undefined>(undefined);
  shownFavorite.current =
    pendingChanges.isFavorited ?? Boolean(card?.isFavorited);
  const favoritesInFlight = useRef(0);

  const toggleFavorite = useCallback(() => {
    if (!card) {
      return;
    }

    const newFavoriteState = !shownFavorite.current;
    shownFavorite.current = newFavoriteState;
    const previousCard = card;
    const updatedCard = {
      ...card,
      isFavorited: newFavoriteState,
      updatedAt: Date.now(),
    };
    config.onCardUpdate?.(updatedCard);
    setPendingChanges((prev) => ({ ...prev, isFavorited: newFavoriteState }));
    favoritesInFlight.current += 1;
    void updateField("isFavorited").then((didUpdate) => {
      favoritesInFlight.current -= 1;
      if (!didUpdate) {
        config.onCardUpdate?.(previousCard);
      }
      if (favoritesInFlight.current === 0) {
        setPendingChanges((prev) => ({ ...prev, isFavorited: undefined }));
      }
    });
  }, [card, config.onCardUpdate, updateField]);

  const setDone = useCallback(
    async (done: boolean, { isUndo = false } = {}) => {
      if (
        !(cardId && card?.type === "link") ||
        doneInFlight.current.has(cardId)
      ) {
        return;
      }
      const category = card.metadata?.linkCategory?.category;
      const verb = doneActionLabel(category);
      doneInFlight.current.add(cardId);
      setPendingDone((pending) => ({ ...pending, [cardId]: done }));
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: done ? "done" : "undone",
        });
        captureEvent("card_done_toggled", {
          category: category ?? "none",
          done,
          source: "panel",
        });
        if (!isUndo) {
          toast.success(t(done ? "markedDone" : "markedNotDone", { verb }), {
            duration: UNDO_TOAST_DURATION_MS,
            action: {
              label: tc("undo"),
              onClick: () => {
                void setDone(!done, { isUndo: true });
              },
            },
          });
        }
      } catch (error) {
        console.error("Failed to update done state:", error);
        toast.error(t("doneUpdateFailed"));
        config.onError?.(error as Error, "update done state");
      } finally {
        doneInFlight.current.delete(cardId);
        setPendingDone((pending) => {
          const { [cardId]: _settled, ...rest } = pending;
          return rest;
        });
      }
    },
    [card, cardId, config.onError, t, tc, updateCardField]
  );

  const toggleDone = useCallback(() => {
    if (!card) {
      return;
    }
    const isDone = pendingDone[card._id] ?? card.completedAt !== undefined;
    void setDone(!isDone);
  }, [card, pendingDone, setDone]);

  const removeAiTag = useCallback(
    (tagToRemove: string) => {
      void updateField("removeAiTag", undefined, tagToRemove);
    },
    [updateField]
  );

  // The tags the card has once the writes on their way land. A second edit
  // before the card catches up builds on the first, so quick edits all stick.
  const tagWrites = useRef<{
    cardId: string | null;
    pending?: string[];
    seen?: string[];
  }>({ cardId });
  if (
    tagWrites.current.cardId !== cardId ||
    tagWrites.current.seen !== card?.tags
  ) {
    tagWrites.current = { cardId, seen: card?.tags };
  }
  const currentTags = useCallback(
    () => tagWrites.current.pending ?? tagWrites.current.seen ?? [],
    []
  );
  const writeTags = useCallback(
    async (tags: string[]) => {
      tagWrites.current.pending = tags;
      const didUpdate = await updateField("tags", tags);
      if (!didUpdate && tagWrites.current.pending === tags) {
        tagWrites.current.pending = undefined;
      }
      return didUpdate;
    },
    [updateField]
  );

  /** Keeps a tag Teak suggested as one of the card's own tags. */
  const acceptAiTag = useCallback(
    (tag: string) => {
      const tags = currentTags();
      if (!tags.some((existing) => tagKey(existing) === tagKey(tag))) {
        void writeTags([...tags, tag]);
      }
    },
    [currentTags, writeTags]
  );

  const addTag = useCallback(() => {
    const tag = tagKey(tagInput);
    if (!tag) {
      return;
    }
    const tags = currentTags();
    const existing = tags.find((current) => tagKey(current) === tag);
    if (existing) {
      setTagInput("");
      toast(t("alreadyTagged", { tag: existing }));
      return;
    }
    const newTags = [...tags, tag];
    const invalid = explainInvalidCardTags(newTags, tags);
    if (invalid) {
      toast.error(serverErrors.byEnglishMessage(invalid));
      return;
    }
    const hides = Boolean(card) && !isCardHidden(card as Doc<"cards">);
    setTagInput("");
    void writeTags(newTags).then((didUpdate) => {
      if (didUpdate && hides && isHiddenTagList([tag])) {
        toast(t("hiddenByTag", { tag }), {
          duration: UNDO_TOAST_DURATION_MS,
          action: {
            label: tc("undo"),
            onClick: () => {
              const without = (tags: string[]) =>
                tags.filter((current) => current !== tag);
              if (tagWrites.current.cardId === cardId) {
                void writeTags(without(currentTags()));
              } else {
                // Another card is open now; this one's tags aren't tracked.
                void updateField("tags", without(newTags));
              }
            },
          },
        });
      }
    });
  }, [
    card,
    cardId,
    currentTags,
    serverErrors,
    t,
    tagInput,
    tc,
    updateField,
    writeTags,
  ]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      void writeTags(currentTags().filter((tag) => tag !== tagToRemove));
    },
    [currentTags, writeTags]
  );

  // The card whose delete is in flight: a second Delete on it is ignored,
  // while a card stepped to meanwhile can still be deleted.
  const deletingIdRef = useRef<string | null>(null);
  const handleDelete = useCallback(
    async (onClose?: () => void) => {
      if (!cardId || deletingIdRef.current === cardId) {
        return;
      }
      deletingIdRef.current = cardId;
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "delete",
        });
        const deletedId = cardId;
        toast.success(t("cardDeleted"), {
          duration: UNDO_TOAST_DURATION_MS,
          action: {
            label: tc("undo"),
            onClick: () => {
              updateCardField({
                cardId: deletedId as Id<"cards">,
                field: "restore",
              }).catch(() => toast.error(t("restoreFailed")));
            },
          },
        });
        // Stepping to another card while the delete ran keeps that one open.
        if (openCardIdRef.current === deletedId) {
          onClose?.();
        }
      } catch (error) {
        console.error("Failed to delete card:", error);
        toast.error(t("deleteFailed"));
      } finally {
        if (deletingIdRef.current === cardId) {
          deletingIdRef.current = null;
        }
      }
    },
    [cardId, t, tc, updateCardField]
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
        toast.success(t("cardRestored"));
        onClose?.();
      } catch (error) {
        console.error("Failed to restore card:", error);
        toast.error(t("restoreFailed"));
      }
    },
    [cardId, t, updateCardField]
  );

  const handlePermanentDelete = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) {
        return;
      }
      try {
        await permanentDeleteCard({ id: cardId as Id<"cards"> });
        toast.success(t("cardPermanentlyDeleted"));
        onClose?.();
      } catch (error) {
        console.error("Failed to permanently delete card:", error);
        toast.error(t("permanentDeleteFailed"));
      }
    },
    [cardId, permanentDeleteCard, t]
  );

  const openLink = useCallback(() => {
    const safeUrl = sanitizeExternalUrl(card?.url);
    if (safeUrl && card) {
      if (config.onOpenLink) {
        config.onOpenLink(safeUrl);
      } else if (typeof window !== "undefined") {
        openCardLink(card);
      }
    } else if (card?.url) {
      toast.error(t("unsafeLink"));
    }
  }, [card, config.onOpenLink, t]);

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
    let completedAt = card.completedAt;
    const pending = pendingDone[card._id];
    if (pending !== undefined) {
      completedAt = pending ? (card.completedAt ?? Date.now()) : undefined;
    }
    return {
      ...card,
      completedAt,
      isFavorited:
        pendingChanges.isFavorited === undefined
          ? card.isFavorited
          : pendingChanges.isFavorited,
    } satisfies CardWithUrls;
  }, [card, pendingChanges.isFavorited, pendingDone]);

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
    toggleDone,
    removeAiTag,
    acceptAiTag,
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
