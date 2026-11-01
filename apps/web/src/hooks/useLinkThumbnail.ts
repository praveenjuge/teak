import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { toThumbnailMimeType } from "@teak/convex/shared/thumbnails";
import { useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  uploadAttemptTimeoutMs,
  uploadWithTransientRetry,
} from "@/lib/upload/transport";
import {
  linkThumbnailErrorMessage,
  linkThumbnailFileProblem,
} from "../lib/linkThumbnail";

export type LinkThumbnailSource = "drop" | "paste" | "pick";

export interface LinkThumbnailControl {
  isBusy: boolean;
  replace: (file: File, source: LinkThumbnailSource) => void;
  reset: () => void;
  uploadingPreviewUrl?: string;
}

export function useLinkThumbnail(
  cardId: string | null | undefined
): LinkThumbnailControl {
  const t = useTranslations("hooks.linkThumbnail");
  const tl = useTranslations("lib.linkThumbnail");
  const tc = useTranslations("common");
  const errors = useTranslations("errors");
  const createUploadUrl = useMutation(
    api.card.thumbnailOverride.createThumbnailUploadUrl
  );
  const setLinkThumbnail = useAction(
    api.card.thumbnailOverride.setLinkThumbnail
  );
  const resetLinkThumbnail = useMutation(
    api.card.thumbnailOverride.resetLinkThumbnail
  );
  const undoThumbnailChange = useMutation(
    api.card.thumbnailOverride.undoThumbnailChange
  );
  const [active, setActive] = useState<{
    cardId: string;
    previewUrl?: string;
  } | null>(null);
  const busy = useRef<boolean>(false);
  const activePreviewUrl = active?.previewUrl;

  useEffect(() => {
    if (!activePreviewUrl) {
      return;
    }
    return () => URL.revokeObjectURL(activePreviewUrl);
  }, [activePreviewUrl]);

  const offerUndo = useCallback(
    (
      id: Id<"cards">,
      message: string,
      change: { changeId: string | null; undoUntil: number | null }
    ) => {
      const { changeId, undoUntil } = change;
      toast.success(message, {
        duration: undoUntil ? Math.max(undoUntil - Date.now(), 4000) : 4000,
        action: changeId
          ? {
              label: tc("undo"),
              onClick: () => {
                undoThumbnailChange({ cardId: id, changeId })
                  .then((result) => {
                    if (result.status === "expired") {
                      toast.error(t("undoExpired"));
                    }
                  })
                  .catch((error: unknown) =>
                    toast.error(linkThumbnailErrorMessage(error, errors, tl))
                  );
              },
            }
          : undefined,
      });
    },
    [errors, t, tc, tl, undoThumbnailChange]
  );

  const run = useCallback(
    async (id: string, work: () => Promise<void>, preview?: File) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      setActive({
        cardId: id,
        previewUrl: preview ? URL.createObjectURL(preview) : undefined,
      });
      try {
        await work();
      } catch (error) {
        toast.error(linkThumbnailErrorMessage(error, errors, tl));
      } finally {
        busy.current = false;
        setActive(null);
      }
    },
    [errors, tl]
  );

  const replace = useCallback(
    (file: File, source: LinkThumbnailSource) => {
      if (!cardId) {
        return;
      }
      const problem = linkThumbnailFileProblem(file, errors);
      if (problem) {
        toast.error(problem);
        return;
      }
      const id = cardId as Id<"cards">;
      const mimeType = toThumbnailMimeType(file.type) ?? file.type;
      run(
        id,
        async () => {
          const upload = await createUploadUrl({
            cardId: id,
            fileSize: file.size,
            mimeType,
          });
          const response = await uploadWithTransientRetry(
            (signal) =>
              fetch(upload.uploadUrl, {
                body: file,
                headers: { "Content-Type": mimeType },
                method: "PUT",
                signal,
              }),
            new AbortController().signal,
            { timeoutMs: uploadAttemptTimeoutMs(file.size) }
          );
          if (!response.ok) {
            throw new Error(`Upload failed with status ${response.status}`);
          }
          const change = await setLinkThumbnail({
            cardId: id,
            fileKey: upload.fileKey,
          });
          captureEvent("card_thumbnail_replaced", { source });
          offerUndo(id, t("replaced"), change);
        },
        file
      ).catch(() => undefined);
    },
    [cardId, createUploadUrl, errors, offerUndo, run, setLinkThumbnail, t]
  );

  const reset = useCallback(() => {
    if (!cardId) {
      return;
    }
    const id = cardId as Id<"cards">;
    run(id, async () => {
      const change = await resetLinkThumbnail({ cardId: id });
      if (change.changeId) {
        captureEvent("card_thumbnail_reset");
      }
      offerUndo(id, t("reset"), change);
    }).catch(() => undefined);
  }, [cardId, offerUndo, resetLinkThumbnail, run, t]);

  const isActiveCard = Boolean(active && active.cardId === cardId);
  return {
    isBusy: isActiveCard,
    replace,
    reset,
    uploadingPreviewUrl: isActiveCard ? activePreviewUrl : undefined,
  };
}
