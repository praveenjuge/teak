import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { recordClientOutcome } from "@teak/convex/shared/client-telemetry";
import { useAction } from "convex/react";
import type { CSSProperties, ImgHTMLAttributes, SyntheticEvent } from "react";
import { useEffect, useState } from "react";
import {
  appendMediaRetryParam,
  canRetryMedia,
  getMediaRenditionFromUrl,
} from "./mediaRecovery";

interface ResilientMediaImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "onError" | "src"> {
  alt: string;
  cardId?: string;
  fallbackStyle?: CSSProperties;
  onPermanentError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  src: string;
  storageKey?: string;
}

export function ResilientMediaImage({
  alt,
  cardId,
  fallbackStyle,
  height = 512,
  onPermanentError,
  src,
  srcSet,
  storageKey,
  width = 512,
  ...imageProps
}: ResilientMediaImageProps) {
  const refreshMediaUrl = useAction(api.card.getFileUrl.refreshCardMediaUrl);
  const [displaySrc, setDisplaySrc] = useState(src);
  const [displaySrcSet, setDisplaySrcSet] = useState(srcSet);
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDisplaySrc(src);
    setDisplaySrcSet(srcSet);
    setRetryCount(0);
    setFailed(false);
  }, [src, srcSet]);

  const handleError = async (event: SyntheticEvent<HTMLImageElement>) => {
    const attemptedUrl = event.currentTarget.currentSrc || displaySrc;
    if (!(cardId && storageKey && canRetryMedia(attemptedUrl, retryCount))) {
      setFailed(true);
      onPermanentError?.(event);
      return;
    }
    setRetryCount(1);
    const rendition = getMediaRenditionFromUrl(attemptedUrl);
    try {
      const { url } = await refreshMediaUrl({
        cardId: cardId as Id<"cards">,
        key: storageKey,
        rendition,
      });
      setDisplaySrcSet(undefined);
      setDisplaySrc(appendMediaRetryParam(url));
      recordClientOutcome({
        attributes: { "media.rendition": rendition ?? "original" },
        category: "media",
        message: "Media URL recovered",
        outcome: "success",
      });
    } catch {
      setFailed(true);
      recordClientOutcome({
        attributes: { "media.rendition": rendition ?? "original" },
        category: "media",
        message: "Media URL recovery failed",
        outcome: "failure",
      });
      onPermanentError?.(event);
    }
  };

  if (failed) {
    return (
      <span aria-hidden className="block h-full w-full" style={fallbackStyle} />
    );
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: load errors recover the non-interactive media URL
    <img
      {...imageProps}
      alt={alt}
      height={height}
      onError={(event) => void handleError(event)}
      src={displaySrc}
      srcSet={displaySrcSet}
      width={width}
    />
  );
}
