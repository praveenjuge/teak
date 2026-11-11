import type {
  CSSProperties,
  ImgHTMLAttributes,
  ReactNode,
  SyntheticEvent,
} from "react";
import { useState } from "react";
import { useMediaUrlRecovery } from "./useMediaUrlRecovery";

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
  const media = useMediaUrlRecovery({ cardId, src, srcSet, storageKey });
  // The source that couldn't load, so a new one gets its own try.
  const source = `${src} ${srcSet ?? ""}`;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === source;

  const handleError = async (event: SyntheticEvent<HTMLImageElement>) => {
    // Read the element now: React clears currentTarget once this awaits.
    const attemptedUrl = event.currentTarget.currentSrc || media.src || "";
    if (!(await media.retry(attemptedUrl))) {
      setFailedSource(source);
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
      src={media.src}
      srcSet={media.srcSet}
      width={width}
    />
  );
}
