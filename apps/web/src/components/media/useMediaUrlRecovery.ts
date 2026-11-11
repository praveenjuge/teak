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
 * A media URL that asks for a fresh signed URL once when it fails to load:
 * signed URLs expire while a page, or a long video, stays open. `retry`
 * takes the URL that failed and resolves true while the fresh one loads,
 * false once there's nothing left to try. A fresh URL replaces `srcSet`,
 * whose other renditions were signed alongside the one that failed.
 *
 * For audio and video, `onError` also notes where playback was, and
 * `resume` picks up there once the new URL's metadata loads.
 */
export function useMediaUrlRecovery({
  cardId,
  src,
  srcSet,
  storageKey,
}: {
  cardId?: string;
  src: string | undefined;
  srcSet?: string;
  storageKey?: string;
}) {
  const refreshMediaUrl = useAction(api.cards.refreshCardMediaUrl);
  const [display, setDisplay] = useState({ src, srcSet });
  const retried = useRef<boolean>(false);
  const resumeAt = useRef<{ playing: boolean; time: number } | null>(null);

  useEffect(() => {
    setDisplay({ src, srcSet });
    retried.current = false;
  }, [src, srcSet]);

  const retry = useCallback(
    async (failedUrl: string) => {
      if (
        retried.current ||
        !(cardId && storageKey && canRetryMedia(failedUrl))
      ) {
        return false;
      }
      retried.current = true;
      try {
        const { url } = await refreshMediaUrl({
          cardId: cardId as Id<"cards">,
          key: storageKey,
          rendition: getMediaRenditionFromUrl(failedUrl),
        });
        setDisplay({ src: appendMediaRetryParam(url), srcSet: undefined });
        return true;
      } catch {
        return false;
      }
    },
    [cardId, refreshMediaUrl, storageKey]
  );

  const onError = useCallback(
    async (element?: HTMLMediaElement | null, playing?: boolean) => {
      resumeAt.current =
        element && element.currentTime > 0
          ? {
              playing: playing ?? !element.paused,
              time: element.currentTime,
            }
          : null;
      const retrying = await retry(display.src ?? "");
      if (!retrying) {
        resumeAt.current = null;
      }
      return retrying;
    },
    [display.src, retry]
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

  return { onError, resume, retry, src: display.src, srcSet: display.srcSet };
}
