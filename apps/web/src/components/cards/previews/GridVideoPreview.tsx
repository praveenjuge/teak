import { useTranslations } from "@teak/i18n/react";
import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Play } from "vadivam-react";
import { CARD_SURFACE } from "../cardDisplay";
import type { ScrubMetadata } from "../types";
import { ResilientMediaImage } from "./ResilientMediaImage";

interface GridVideoPreviewProps {
  cardId?: string;
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

function PlayOverlay() {
  return (
    <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex size-7 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md">
      <Play className="size-3.5 translate-x-px fill-current" />
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

function isValidScrub(scrub?: ScrubMetadata): scrub is ScrubMetadata {
  return !!scrub && Number.isFinite(scrub.frames) && scrub.frames >= 1;
}

function ScrubPreview({
  aspectRatio,
  cardId,
  isPriority,
  scrub,
  scrubKey,
  scrubUrl,
  thumbnailKey,
  thumbnailUrl,
}: {
  aspectRatio: number;
  cardId?: string;
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
      className={`relative h-full w-full overflow-hidden ${CARD_SURFACE}`}
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
          className={`pointer-events-none absolute top-0 left-0 h-full max-w-none ${showSprite ? "" : "opacity-0"}`}
          decoding="async"
          draggable={false}
          onLoad={() => setIsSpriteLoaded(true)}
          src={scrubUrl}
          storageKey={scrubKey}
          style={{
            transform: `translateX(-${(frame / scrub.frames) * 100}%)`,
            width: `${scrub.frames * 100}%`,
          }}
        />
      ) : null}

      {isScrubbing ? null : <PlayOverlay />}
    </div>
  );
}

/** Someone who asked for less motion keeps the still and the play button. */
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function HoverVideoPreview({
  aspectRatio,
  cardId,
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
}) {
  const t = useTranslations("cards.previews");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

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
      className={`relative h-full w-full overflow-hidden ${CARD_SURFACE}`}
      onMouseEnter={() => {
        if (prefersReducedMotion()) {
          return;
        }
        setShouldLoadVideo(true);
        setIsHovering(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);
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

      {isHovering ? null : <PlayOverlay />}
    </div>
  );
}

export function GridVideoPreview({
  cardId,
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
  const aspectRatio = width && height ? width / height : 16 / 9;

  if (isGif && videoUrl) {
    return (
      <div
        className={`relative h-full w-full overflow-hidden ${CARD_SURFACE}`}
        style={{ aspectRatio }}
      >
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
        isPriority={isPriority}
        thumbnailKey={thumbnailKey}
        thumbnailUrl={thumbnailUrl}
        videoUrl={videoUrl}
      />
    );
  }

  if (thumbnailUrl) {
    return (
      <div
        className={`relative h-full w-full overflow-hidden ${CARD_SURFACE}`}
        style={{ aspectRatio }}
      >
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
        <PlayOverlay />
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${CARD_SURFACE} bg-black text-white`}
      style={{ aspectRatio }}
    >
      <Play className="size-6 text-white" />
    </div>
  );
}
