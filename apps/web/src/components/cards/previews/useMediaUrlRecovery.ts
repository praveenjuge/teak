import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendMediaRetryParam,
  canRetryMedia,
  getMediaRenditionFromUrl,
} from "./mediaRecovery";

/**
 * A media URL that asks for a fresh signed URL once when it fails to load,
 * for audio and video that stay open long enough for the first to expire.
 * `onError` resolves true while that retry is under way, false once there's
 * nothing left to try.
 */
export function useMediaUrlRecovery({
  cardId,
  src,
  storageKey,
}: {
  cardId?: string;
  src: string | undefined;
  storageKey?: string;
}): { onError: () => Promise<boolean>; src: string | undefined } {
  const refreshMediaUrl = useAction(api.card.getFileUrl.refreshCardMediaUrl);
  const [displaySrc, setDisplaySrc] = useState(src);
  const retried = useRef<boolean>(false);

  useEffect(() => {
    setDisplaySrc(src);
    retried.current = false;
  }, [src]);

  const onError = useCallback(async () => {
    const failed = displaySrc ?? "";
    if (
      retried.current ||
      !(cardId && storageKey && canRetryMedia(failed, 0))
    ) {
      return false;
    }
    retried.current = true;
    try {
      const { url } = await refreshMediaUrl({
        cardId: cardId as Id<"cards">,
        key: storageKey,
        rendition: getMediaRenditionFromUrl(failed),
      });
      setDisplaySrc(appendMediaRetryParam(url));
      return true;
    } catch {
      return false;
    }
  }, [cardId, displaySrc, refreshMediaUrl, storageKey]);

  return { onError, src: displaySrc };
}
