import { Image } from "antd";
import { Play } from "lucide-react";

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

export function GridVideoPreview({
  height,
  isGif,
  thumbnailUrl,
  videoUrl,
  width,
}: GridVideoPreviewProps) {
  const aspectRatio = width && height ? width / height : 16 / 9;

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

  // No generated thumbnail yet: render a real frame from the media itself so
  // the card never falls back to an empty black cover.
  if (videoUrl) {
    if (isGif) {
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

    return (
      <div
        className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
        style={{ aspectRatio }}
      >
        <video
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          // Seek slightly into the clip so we render actual content instead of
          // a leading black frame.
          src={`${videoUrl}#t=0.1`}
        >
          <track kind="captions" />
        </video>
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
