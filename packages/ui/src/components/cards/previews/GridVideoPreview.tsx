import { Image } from "antd";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface GridVideoPreviewProps {
  height?: number;
  isGif?: boolean;
  thumbnailUrl?: string;
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
  thumbnailUrl,
  videoUrl,
}: {
  aspectRatio: number;
  thumbnailUrl?: string;
  videoUrl: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  // Defer mounting the video until first hover when a thumbnail can cover idle.
  // Without a thumbnail, mount immediately so the card still shows a frame.
  const [shouldLoadVideo, setShouldLoadVideo] = useState(!thumbnailUrl);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldLoadVideo) {
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
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
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
          <Image
            alt="Video thumbnail"
            className="h-full w-full object-cover"
            loading="lazy"
            preview={false}
            rootClassName="h-full w-full"
            src={thumbnailUrl}
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
  height,
  isGif,
  thumbnailUrl,
  videoUrl,
  width,
}: GridVideoPreviewProps) {
  const aspectRatio = width && height ? width / height : 16 / 9;

  if (isGif && videoUrl) {
    return (
      <div
        className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
        style={{ aspectRatio }}
      >
        <img
          alt="GIF preview"
          className="h-full w-full object-cover"
          height={height ?? 480}
          loading="lazy"
          src={videoUrl}
          width={width ?? 640}
        />
      </div>
    );
  }

  if (videoUrl) {
    return (
      <HoverVideoPreview
        aspectRatio={aspectRatio}
        thumbnailUrl={thumbnailUrl}
        videoUrl={videoUrl}
      />
    );
  }

  if (thumbnailUrl) {
    return (
      <div
        className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
        style={{ aspectRatio }}
      >
        <Image
          alt="Video thumbnail"
          className="h-full w-full object-cover"
          loading="lazy"
          preview={false}
          rootClassName="h-full w-full"
          src={thumbnailUrl}
          style={{ objectFit: "cover" }}
        />
        <PlayOverlay />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border bg-black text-white"
      style={{ aspectRatio }}
    >
      <Play className="size-6 text-white" />
    </div>
  );
}
