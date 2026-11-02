import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { MANUAL_CLOSE_TOAST_OPTIONS } from "@/constants/toast";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useUpgradeAction } from "@/hooks/useUpgradeAction";
import { isCardLimitError, isRateLimitError } from "@/lib/cardErrors";
import { addCaptureToSearchQueries } from "../../lib/cardQueryOptimisticUpdates";
import {
  noteCaptureSavedMessage,
  prepareNoteCapture,
} from "../text-editor/noteCapture";

export interface SaveNoteOptions {
  onOpenCard?: (cardId: string) => void;
  onSuccess?: () => void;
  onUpgrade?: () => void;
  upgradeUrl?: string;
}

export interface SaveNoteCallbacks {
  /** Nothing was saved (an error, or the same note is in Trash). */
  onNotSaved?: () => void;
  /** The note in Trash came back after "Restore". */
  onRestored?: () => void;
  /** Where the save came from, for analytics. */
  via?: "text_form" | "empty_search";
}

/**
 * Saves text as a note the way the composer does: shown at once (offline
 * too), with a toast for each outcome — saved, already in Teak, in Trash
 * (with Restore), over the card limit (with Upgrade) or failed.
 */
export function useSaveNote({
  onOpenCard,
  onSuccess,
  onUpgrade,
  upgradeUrl,
}: SaveNoteOptions = {}) {
  const t = useTranslations("forms.addCard");
  const tLimits = useTranslations("forms.limits");
  const tEditor = useTranslations("textEditor");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const { showUpgradeToast } = useUpgradeAction(onUpgrade, upgradeUrl);
  const createCard = useMutation(
    api.cards.createCardWithOutcome
  ).withOptimisticUpdate((localStore, args) => {
    addCaptureToSearchQueries(localStore, {
      content: args.content ?? "",
      id: crypto.randomUUID() as Id<"cards">,
      now: Date.now(),
    });
  });

  const failed = useCallback(
    (error: unknown, toastId: string | number, fallback: string) => {
      if (isCardLimitError(error)) {
        showUpgradeToast(toastId);
      } else if (isRateLimitError(error)) {
        toast.error(tLimits("rateLimited"), { id: toastId });
      } else {
        // A plain Error here is Convex's own text ("[CONVEX M(...)] Server
        // Error"), which isn't for people; server reasons still come through.
        toast.error(errors.message(error, fallback), { id: toastId });
      }
    },
    [errors, showUpgradeToast, tLimits]
  );

  const openAction = useCallback(
    (cardId: string) =>
      onOpenCard
        ? { action: { label: t("open"), onClick: () => onOpenCard(cardId) } }
        : {},
    [onOpenCard, t]
  );

  const restoreFromTrash = useCallback(
    async (text: string, toastId: string | number, onRestored?: () => void) => {
      toast.loading(t("restoring"), { id: toastId });
      try {
        const capture = prepareNoteCapture(text);
        const saved = await createCard({
          ...capture,
          source: "web",
          trashedDuplicate: "restore",
        });
        onRestored?.();
        onSuccess?.();
        // The card may have left Trash (or been deleted) since the first save.
        let message = noteCaptureSavedMessage(capture, tEditor);
        if (saved.wasTrashed) {
          message = t("restoredFromTrash");
        } else if (saved.outcome === "resaved") {
          message = t("resaved");
        }
        toast.success(message, { id: toastId, ...openAction(saved.cardId) });
      } catch (error) {
        console.error("Failed to restore card:", error);
        failed(error, toastId, t("restoreFailed"));
      }
    },
    [createCard, failed, onSuccess, openAction, t, tEditor]
  );

  const saveNote = useCallback(
    async (
      text: string,
      { onNotSaved, onRestored, via = "text_form" }: SaveNoteCallbacks = {}
    ): Promise<boolean> => {
      // Offline, the note still shows at once and saves on reconnecting.
      const toastId = toast.loading(
        navigator.onLine ? tc("saving") : t("savingOffline")
      );
      captureEvent("card_create_submitted", {
        card_type: "text",
        source: "web",
        via,
      });
      try {
        const capture = prepareNoteCapture(text);
        const saved = await createCard({
          ...capture,
          source: "web",
          trashedDuplicate: "report",
        });
        if (saved.outcome === "inTrash") {
          // Nothing was saved: the toast offers the card in Trash instead of
          // a second copy.
          onNotSaved?.();
          toast.info(t("inTrash"), {
            ...MANUAL_CLOSE_TOAST_OPTIONS,
            action: {
              label: t("restore"),
              onClick: () => {
                void restoreFromTrash(text, toastId, onRestored);
              },
            },
            id: toastId,
          });
          return false;
        }
        onSuccess?.();
        if (saved.outcome === "resaved") {
          toast.success(
            saved.wasArchived ? t("resavedFromArchive") : t("resaved"),
            { id: toastId, ...openAction(saved.cardId) }
          );
        } else {
          toast.success(noteCaptureSavedMessage(capture, tEditor), {
            id: toastId,
          });
        }
        return true;
      } catch (error) {
        console.error("Failed to create card:", error);
        onNotSaved?.();
        failed(error, toastId, t("saveFailed"));
        return false;
      }
    },
    [
      createCard,
      failed,
      onSuccess,
      openAction,
      restoreFromTrash,
      t,
      tc,
      tEditor,
    ]
  );

  return { saveNote };
}

/**
 * "Save as a note" for a search that found nothing: `save` is undefined
 * when there are no words to save. One save at a time, since offline or on
 * a slow connection the empty state stays until the server answers and each
 * click would save another copy.
 */
export function useSaveSearchAsNote({
  noteText,
  ...options
}: SaveNoteOptions & { noteText: string | null }) {
  const { saveNote } = useSaveNote(options);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef<boolean>(false);
  const save = noteText
    ? () => {
        if (inFlight.current) {
          return;
        }
        inFlight.current = true;
        setSaving(true);
        void saveNote(noteText, { via: "empty_search" }).finally(() => {
          inFlight.current = false;
          setSaving(false);
        });
      }
    : undefined;
  return { save, saving };
}
