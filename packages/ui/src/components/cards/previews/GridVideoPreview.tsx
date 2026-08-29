import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ResilientMediaImage } from "./ResilientMediaImage";

interface GridVideoPreviewProps {
  cardId?: string;
  height?: number;
  isGif?: boolean;
  isPriority?: boolean;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  videoKey?: string;
  videoUrl?: string;
  width?: number;
}

function PlayOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
      <div className="rounded-full bg-black/50 p-2">
        <Play className="size-6 text-white" />
      </div>
    </div>
  );
}

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  // Never fetch video bytes before intent; the poster or neutral placeholder
  // keeps an idle grid lightweight.
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!(video && shouldLoadVideo)) {
      return;
    }

    if (isHovering) {
      void video.play().catch(() => {
        // Autoplay may be blocked; keep the idle thumbnail/frame visible.
      });
      return;
    }

    video.pause();
    try {
      // Seek slightly into the clip so idle frames aren't a leading black frame.
      video.currentTime = 0.1;
    } catch {
      // Ignore seek errors before metadata is ready.
    }
  }, [isHovering, shouldLoadVideo]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-only autoplay preview; native video controls stay keyboard-accessible
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: hover-only autoplay preview; native video controls stay keyboard-accessible
    <div
      className="relative h-full w-full overflow-hidden rounded-2xl border bg-card"
      onMouseEnter={() => {
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
            alt="Video thumbnail"
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
  thumbnailKey,
  thumbnailUrl,
  videoKey,
  videoUrl,
  width,
}: GridVideoPreviewProps) {
  const aspectRatio = width && height ? width / height : 16 / 9;

  if (isGif && videoUrl) {
    return (
      <div
        className="relative h-full w-full overflow-hidden rounded-2xl border bg-card"
        style={{ aspectRatio }}
      >
        <ResilientMediaImage
          alt="GIF preview"
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
        className="relative h-full w-full overflow-hidden rounded-2xl border bg-card"
        style={{ aspectRatio }}
      >
        <ResilientMediaImage
          alt="Video thumbnail"
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
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border bg-black text-white"
      style={{ aspectRatio }}
    >
      <Play className="size-6 text-white" />
    </div>
  );
}
