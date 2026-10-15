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

/** What the card dialog needs to replace or reset a link's image. */
export interface LinkThumbnailControl {
  /** True while an upload, apply or reset is running. */
  isBusy: boolean;
  replace: (file: File, source: LinkThumbnailSource) => void;
  reset: () => void;
  /** The file being uploaded, shown at once while it uploads. */
  uploadingPreviewUrl?: string;
}

/**
 * Replace a link card's image with a dropped, pasted or picked file, or go
 * back to the one Teak found. Each change offers Undo for as long as the
 * server keeps the image it replaced.
 */
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
  const [uploadingPreviewUrl, setUploadingPreviewUrl] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const busy = useRef(false);

  // The local preview belongs to this card's dialog only.
  useEffect(() => {
    if (!uploadingPreviewUrl) {
      return;
    }
    return () => URL.revokeObjectURL(uploadingPreviewUrl);
  }, [uploadingPreviewUrl]);

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

  const run = useCallback(async (work: () => Promise<void>) => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setIsBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(linkThumbnailErrorMessage(error));
    } finally {
      busy.current = false;
      setIsBusy(false);
      setUploadingPreviewUrl(undefined);
    }
  }, []);

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
      run(async () => {
        setUploadingPreviewUrl(URL.createObjectURL(file));
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
      }).catch(() => undefined);
    },
    [cardId, createUploadUrl, offerUndo, run, setLinkThumbnail]
  );

  const reset = useCallback(() => {
    if (!cardId) {
      return;
    }
    const id = cardId as Id<"cards">;
    run(async () => {
      const change = await resetLinkThumbnail({ cardId: id });
      if (change.changeId) {
        captureEvent("card_thumbnail_reset");
      }
      offerUndo(id, "Back to the original image", change);
    }).catch(() => undefined);
  }, [cardId, offerUndo, resetLinkThumbnail, run]);

  return { isBusy, replace, reset, uploadingPreviewUrl };
}
