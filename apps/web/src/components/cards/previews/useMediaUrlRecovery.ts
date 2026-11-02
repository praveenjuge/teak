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
 * nothing left to try. Given the element that failed, it notes where playback
 * was, and `resume` picks up there once the new URL's metadata loads.
 */
export function useMediaUrlRecovery({
  cardId,
  src,
  storageKey,
}: {
  cardId?: string;
  src: string | undefined;
  storageKey?: string;
}): {
  onError: (
    element?: HTMLMediaElement | null,
    playing?: boolean
  ) => Promise<boolean>;
  resume: (element: HTMLMediaElement) => void;
  src: string | undefined;
} {
  const refreshMediaUrl = useAction(api.card.getFileUrl.refreshCardMediaUrl);
  const [displaySrc, setDisplaySrc] = useState(src);
  const retried = useRef<boolean>(false);
  const resumeAt = useRef<{ playing: boolean; time: number } | null>(null);

  useEffect(() => {
    setDisplaySrc(src);
    retried.current = false;
  }, [src]);

  const onError = useCallback(
    async (element?: HTMLMediaElement | null, playing?: boolean) => {
      const failed = displaySrc ?? "";
      if (
        retried.current ||
        !(cardId && storageKey && canRetryMedia(failed, 0))
      ) {
        return false;
      }
      retried.current = true;
      resumeAt.current =
        element && element.currentTime > 0
          ? {
              playing: playing ?? !element.paused,
              time: element.currentTime,
            }
          : null;
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
    },
    [cardId, displaySrc, refreshMediaUrl, storageKey]
  );

  const resume = useCallback((element: HTMLMediaElement) => {
    const at = resumeAt.current;
    if (!at) {
      return;
    }
    resumeAt.current = null;
    element.currentTime = at.time;
    if (at.playing) {
      element.play().catch(() => undefined);
    }
  }, []);

  return { onError, resume, src: displaySrc };
}
