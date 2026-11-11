import { useTranslations } from "@teak/i18n/react";
import type { PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "vadivam-react";
import { ResilientMediaImage } from "../../media";
import { CARD_BADGE, MEDIA_SURFACE, mediaAspectRatio } from "../cardDisplay";
import type { ScrubMetadata } from "../types";

interface GridVideoPreviewProps {
  cardId?: string;
  durationLabel?: string;
  height?: number;
  isGif?: boolean;
  isPriority?: boolean;
  scrub?: ScrubMetadata;
  scrubKey?: string;
  scrubUrl?: string;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  videoKey?: string;
  videoUrl?: string;
  width?: number;
}

function PlayOverlay({ durationLabel }: { durationLabel?: string }) {
  return (
    <div className={CARD_BADGE}>
      <Play aria-hidden="true" className="size-2.5 fill-current" />
      {durationLabel}
    </div>
  );
}

export function scrubFrameIndex(
  x: number,
  width: number,
  frames: number
): number {
  const count = Math.floor(frames);
  if (!(Number.isFinite(x) && width > 0 && count > 1)) {
    return 0;
  }
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

/**
 * Places the scrub sprite so the current frame covers the tile the way the
 * still does: a frame of another shape than the tile (a 9:16 recording in a
 * 3:4 tile) is cropped around its center, never stretched.
 */
export function scrubSpriteStyle(
  frame: number,
  scrub: ScrubMetadata,
  tileRatio: number
): { height: string; left: string; top: string; width: string } {
  const frameRatio =
    scrub.frameWidth > 0 && scrub.frameHeight > 0
      ? scrub.frameWidth / scrub.frameHeight
      : tileRatio;
  const frameWidth = Math.max(frameRatio / tileRatio, 1) * 100;
  const frameHeight = Math.max(tileRatio / frameRatio, 1) * 100;
  const round = (value: number) => `${Number(value.toFixed(4))}%`;
  return {
    height: round(frameHeight),
    left: round(-(frame * frameWidth + (frameWidth - 100) / 2)),
    top: round(-(frameHeight - 100) / 2),
    width: round(scrub.frames * frameWidth),
  };
}

function isValidScrub(scrub?: ScrubMetadata): scrub is ScrubMetadata {
  return !!scrub && Number.isFinite(scrub.frames) && scrub.frames >= 1;
}

function ScrubPreview({
  aspectRatio,
  cardId,
  durationLabel,
  isPriority,
  scrub,
  scrubKey,
  scrubUrl,
  thumbnailKey,
  thumbnailUrl,
}: {
  aspectRatio: number;
  cardId?: string;
  durationLabel?: string;
  isPriority?: boolean;
  scrub: ScrubMetadata;
  scrubKey?: string;
  scrubUrl: string;
  thumbnailKey?: string;
  thumbnailUrl?: string;
}) {
  const t = useTranslations("cards.previews");
  const [hasHovered, setHasHovered] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSpriteLoaded, setIsSpriteLoaded] = useState(false);
  const [frame, setFrame] = useState(0);
  const showSprite = isScrubbing && isSpriteLoaded;

  const trackPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFrame(
      scrubFrameIndex(event.clientX - rect.left, rect.width, scrub.frames)
    );
  };

  return (
    <div
      className={MEDIA_SURFACE}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") {
          return;
        }
        setHasHovered(true);
        setIsScrubbing(true);
        trackPointer(event);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") {
          return;
        }
        setIsScrubbing(false);
        setFrame(0);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") {
          trackPointer(event);
        }
      }}
      style={{ aspectRatio }}
    >
      {thumbnailUrl ? (
        <ResilientMediaImage
          alt={t("videoThumbnail")}
          cardId={cardId}
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority={isPriority ? "high" : undefined}
          loading={isPriority ? "eager" : "lazy"}
          src={thumbnailUrl}
          storageKey={thumbnailKey}
          style={{ objectFit: "cover" }}
        />
      ) : null}

      {hasHovered ? (
        <ResilientMediaImage
          alt=""
          cardId={cardId}
          className={`pointer-events-none absolute max-w-none ${showSprite ? "" : "opacity-0"}`}
          decoding="async"
          draggable={false}
          onLoad={() => setIsSpriteLoaded(true)}
          src={scrubUrl}
          storageKey={scrubKey}
          style={scrubSpriteStyle(frame, scrub, aspectRatio)}
        />
      ) : null}

      {isScrubbing ? null : <PlayOverlay durationLabel={durationLabel} />}
    </div>
  );
}

/** Someone who asked for less motion keeps the still and the play button. */
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Long enough that moving back onto the card plays on without reloading. */
export const HOVER_VIDEO_RELEASE_MS = 2000;

function HoverVideoPreview({
  aspectRatio,
  cardId,
  durationLabel,
  isPriority,
  thumbnailKey,
  thumbnailUrl,
  videoUrl,
}: {
  aspectRatio: number;
  cardId?: string;
  isPriority?: boolean;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  videoUrl: string;
  durationLabel?: string;
}) {
  const t = useTranslations("cards.previews");
  const videoRef = useRef<HTMLVideoElement>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const cancelRelease = useCallback(() => {
    if (releaseTimerRef.current !== null) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelRelease, [cancelRelease]);

  useEffect(() => {
    const video = videoRef.current;
    if (!(video && shouldLoadVideo)) {
      return;
    }

    if (isHovering) {
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    video.currentTime = 0.1;
  }, [isHovering, shouldLoadVideo]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-only autoplay preview; native video controls stay keyboard-accessible
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: hover-only autoplay preview; native video controls stay keyboard-accessible
    <div
      className={MEDIA_SURFACE}
      onMouseEnter={() => {
        if (prefersReducedMotion()) {
          return;
        }
        cancelRelease();
        setShouldLoadVideo(true);
        setIsHovering(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);
        // With a still to fall back on, a video that's done playing leaves
        // the page, so sweeping over a grid doesn't leave one per card.
        // Without one, its first frame is the card's picture, so it stays.
        if (thumbnailUrl) {
          cancelRelease();
          releaseTimerRef.current = setTimeout(() => {
            releaseTimerRef.current = null;
            // A removed video can keep its buffer and decoder until it's
            // collected; dropping its source frees them now, and stops a
            // download that's still running.
            const video = videoRef.current;
            video?.removeAttribute("src");
            video?.load();
            setShouldLoadVideo(false);
          }, HOVER_VIDEO_RELEASE_MS);
        }
      }}
      style={{ aspectRatio }}
    >
      {thumbnailUrl ? (
        <div className={isHovering ? "invisible" : undefined}>
          <ResilientMediaImage
            alt={t("videoThumbnail")}
            cardId={cardId}
            className="h-full w-full object-cover"
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            src={thumbnailUrl}
            storageKey={thumbnailKey}
            style={{ objectFit: "cover" }}
          />
        </div>
      ) : null}

      {shouldLoadVideo ? (
        <video
          className={
            thumbnailUrl
              ? `absolute inset-0 h-full w-full object-cover ${isHovering ? "" : "invisible"}`
              : "h-full w-full object-cover"
          }
          loop
          muted
          playsInline
          preload="metadata"
          ref={videoRef}
          src={videoUrl}
        >
          <track kind="captions" />
        </video>
      ) : null}

      {isHovering ? null : <PlayOverlay durationLabel={durationLabel} />}
    </div>
  );
}

export function GridVideoPreview({
  cardId,
  durationLabel,
  height,
  isGif,
  isPriority,
  scrub,
  scrubKey,
  scrubUrl,
  thumbnailKey,
  thumbnailUrl,
  videoKey,
  videoUrl,
  width,
}: GridVideoPreviewProps) {
  const t = useTranslations("cards.previews");
  const aspectRatio = mediaAspectRatio(width, height, 16 / 9);

  if (isGif && videoUrl) {
    return (
      <div className={MEDIA_SURFACE} style={{ aspectRatio }}>
        <ResilientMediaImage
          alt={t("gifPreview")}
          cardId={cardId}
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority={isPriority ? "high" : undefined}
          height={height ?? 480}
          loading={isPriority ? "eager" : "lazy"}
          src={videoUrl}
          storageKey={videoKey}
          width={width ?? 640}
        />
      </div>
    );
  }

  if (isValidScrub(scrub) && scrubUrl) {
    return (
      <ScrubPreview
        aspectRatio={aspectRatio}
        cardId={cardId}
        durationLabel={durationLabel}
        isPriority={isPriority}
        scrub={scrub}
        scrubKey={scrubKey}
        scrubUrl={scrubUrl}
        thumbnailKey={thumbnailKey}
        thumbnailUrl={thumbnailUrl}
      />
    );
  }

  if (videoUrl) {
    return (
      <HoverVideoPreview
        aspectRatio={aspectRatio}
        cardId={cardId}
        durationLabel={durationLabel}
        isPriority={isPriority}
        thumbnailKey={thumbnailKey}
        thumbnailUrl={thumbnailUrl}
        videoUrl={videoUrl}
      />
    );
  }

  if (thumbnailUrl) {
    return (
      <div className={MEDIA_SURFACE} style={{ aspectRatio }}>
        <ResilientMediaImage
          alt={t("videoThumbnail")}
          cardId={cardId}
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority={isPriority ? "high" : undefined}
          loading={isPriority ? "eager" : "lazy"}
          src={thumbnailUrl}
          storageKey={thumbnailKey}
          style={{ objectFit: "cover" }}
        />
        <PlayOverlay durationLabel={durationLabel} />
      </div>
    );
  }

  return (
    <div
      className={`${MEDIA_SURFACE} flex items-center justify-center bg-black text-white`}
      style={{ aspectRatio }}
    >
      <Play className="size-6 text-white" />
    </div>
  );
}
