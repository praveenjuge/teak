import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClientCard } from "@/lib/cardTypes";
import { openCardLink } from "@/lib/openCardLink";
import { useUpdateCardField } from "./useCardMutations";
import { useWarnBeforeUnload } from "./useWarnBeforeUnload";

export type TextField =
  | "content"
  | "url"
  | "notes"
  | "aiSummary"
  | "metadataTitle";

type PendingChanges = Partial<Record<TextField, string>>;

export type CardSaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface CardModalOptions {
  card?: ClientCard | null;
  onOpenLink?: (url: string) => void;
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
  return (Object.keys(pending) as TextField[])
    .map((field) => ({ field, value: pending[field] }))
    .filter(
      (update): update is { field: TextField; value: string } =>
        update.value !== undefined &&
        !isBlankRequiredField(update.field, update.value) &&
        update.value !== (card[update.field] ?? "") &&
        update.value !== saved[update.field]
    );
}

/** How long "Saved" shows after edits are written. */
const SAVED_CONFIRMATION_MS = 2000;

export function useCardModal(
  cardId: string | null,
  options: CardModalOptions = {}
) {
  const { card = null, onOpenLink } = options;
  const t = useTranslations("hooks.cardActions");
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [savedValues, setSavedValues] = useState<PendingChanges>({});
  const [isSaved, setIsSaved] = useState(false);
  // One timer hides "Saved", and each save restarts it, so an earlier save's
  // timer (on this card or the last one) never cuts the new "Saved" short.
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSavedTimer = useCallback(() => {
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }, []);
  useEffect(() => stopSavedTimer, [stopSavedTimer]);
  // Saves still in flight, for this card or one left meanwhile.
  const [savesInFlight, setSavesInFlight] = useState(0);
  const isSaving = savesInFlight > 0;
  const [saveFailed, setSaveFailed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [editsCardId, setEditsCardId] = useState(cardId);

  if (editsCardId !== cardId) {
    setEditsCardId(cardId);
    setPendingChanges({});
    setSavedValues({});
    setIsSaved(false);
    setSaveFailed(false);
  }

  const notifySaveFailed = useCallback(
    (error: unknown) => {
      captureClientException(error, { operation: "card.update" });
      toast.error(t("failed.saveChanges"));
    },
    [t]
  );

  const updateCardField = useUpdateCardField();
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
          .catch(notifySaveFailed)
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
        stopSavedTimer();
        savedTimerRef.current = setTimeout(() => {
          savedTimerRef.current = null;
          setIsSaved(false);
        }, SAVED_CONFIRMATION_MS);
        return true;
      } catch (error) {
        if (isStillOpen()) {
          setSaveFailed(true);
        }
        notifySaveFailed(error);
        return false;
      } finally {
        setSavesInFlight((count) => count - 1);
      }
    },
    [
      cardId,
      unsavedUpdates,
      updateCardField,
      notifySaveFailed,
      stopSavedTimer,
      t,
    ]
  );

  const saveBeforeLeaving = useCallback(() => {
    void saveChanges({ silent: true });
  }, [saveChanges]);
  useWarnBeforeUnload(hasUnsavedChanges || isSaving, saveBeforeLeaving);

  const updateContent = useCallback((content: string) => {
    setPendingChanges((prev) => ({ ...prev, content }));
  }, []);

  const updateNotes = useCallback((notes: string) => {
    setPendingChanges((prev) => ({ ...prev, notes }));
  }, []);

  const updateTitle = useCallback((metadataTitle: string | undefined) => {
    setPendingChanges((prev) => ({ ...prev, metadataTitle }));
  }, []);

  const openLink = useCallback(() => {
    const safeUrl = sanitizeExternalUrl(card?.url);
    if (safeUrl && card) {
      if (onOpenLink) {
        onOpenLink(safeUrl);
      } else if (typeof window !== "undefined") {
        openCardLink(card);
      }
    } else if (card?.url) {
      toast.error(t("unsafeLink"));
    }
  }, [card, onOpenLink, t]);

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
      const downloadUrl = await convex.query(api.cards.getFileDownloadUrl, {
        cardId: cardId as Id<"cards">,
      });
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
      captureClientException(error, { operation: "card.download" });
      toast.error(t("failed.downloadFile"));
    } finally {
      setIsDownloading(false);
    }
  }, [hasFileObject, card?.fileMetadata?.fileName, cardId, convex, t]);

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

  const getCurrentValue = useCallback(
    (field: TextField) =>
      pendingChanges[field] === undefined
        ? card?.[field]
        : pendingChanges[field],
    [card, pendingChanges]
  );

  return {
    card,
    updateContent,
    updateNotes,
    updateTitle,
    openLink,
    downloadFile,
    saveChanges,
    hasUnsavedChanges,
    getCurrentValue,
    saveState,
    isDownloading,
  };
}
