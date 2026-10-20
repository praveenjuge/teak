import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { uploadWithTransientRetry } from "@teak/convex/client/hooks/fileUploadTransport.client";
import { captureEvent } from "@teak/convex/shared/analytics";
import { toThumbnailMimeType } from "@teak/convex/shared/thumbnails";
import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
              label: "Undo",
              onClick: () => {
                undoThumbnailChange({ cardId: id, changeId })
                  .then((result) => {
                    if (result.status === "expired") {
                      toast.error("It's too late to undo that change.");
                    }
                  })
                  .catch((error: unknown) =>
                    toast.error(linkThumbnailErrorMessage(error))
                  );
              },
            }
          : undefined,
      });
    },
    [undoThumbnailChange]
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
        toast.error(linkThumbnailErrorMessage(error));
      } finally {
        busy.current = false;
        setActive(null);
      }
    },
    []
  );

  const replace = useCallback(
    (file: File, source: LinkThumbnailSource) => {
      if (!cardId) {
        return;
      }
      const problem = linkThumbnailFileProblem(file);
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
            () =>
              fetch(upload.uploadUrl, {
                body: file,
                headers: { "Content-Type": mimeType },
                method: "PUT",
              }),
            new AbortController().signal
          );
          if (!response.ok) {
            throw new Error(`Upload failed with status ${response.status}`);
          }
          const change = await setLinkThumbnail({
            cardId: id,
            fileKey: upload.fileKey,
          });
          captureEvent("card_thumbnail_replaced", { source });
          offerUndo(id, "Image replaced", change);
        },
        file
      ).catch(() => undefined);
    },
    [cardId, createUploadUrl, offerUndo, run, setLinkThumbnail]
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
      offerUndo(id, "Back to the original image", change);
    }).catch(() => undefined);
  }, [cardId, offerUndo, resetLinkThumbnail, run]);

  const isActiveCard = Boolean(active && active.cardId === cardId);
  return {
    isBusy: isActiveCard,
    replace,
    reset,
    uploadingPreviewUrl: isActiveCard ? activePreviewUrl : undefined,
  };
}
