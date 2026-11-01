import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useAction } from "convex/react";
import type {
  CSSProperties,
  ImgHTMLAttributes,
  ReactNode,
  SyntheticEvent,
} from "react";
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
  /** Shown once the image can't load; a blank block by default. */
  fallback?: ReactNode;
  fallbackStyle?: CSSProperties;
  /** Called with the URL that failed once no retry is left. */
  onPermanentError?: (failedUrl: string) => void;
  src: string;
  storageKey?: string;
}

export function ResilientMediaImage({
  alt,
  cardId,
  fallback,
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
    // Read the element now: React clears currentTarget once this awaits.
    const attemptedUrl = event.currentTarget.currentSrc || displaySrc;
    if (!(cardId && storageKey && canRetryMedia(attemptedUrl, retryCount))) {
      setFailed(true);
      onPermanentError?.(attemptedUrl);
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
    } catch {
      setFailed(true);
      onPermanentError?.(attemptedUrl);
    }
  };

  if (failed) {
    return (
      fallback ?? (
        <span
          aria-hidden
          className="block h-full w-full"
          style={fallbackStyle}
        />
      )
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
