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
  if (thumbnailUrl) {
    return (
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <Image
          alt="Video thumbnail"
          className="w-full object-cover"
          loading="lazy"
          placeholder
          preview={false}
          src={thumbnailUrl}
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
        <div className="relative overflow-hidden rounded-xl border bg-card">
          <img
            alt="GIF preview"
            className="w-full object-cover"
            height={height ?? 480}
            loading="lazy"
            src={videoUrl}
            width={width ?? 640}
          />
        </div>
      );
    }

    return (
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <video
          className="w-full object-cover"
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
    <div className="flex h-32 w-full items-center justify-center rounded-xl border bg-black text-white">
      <Play className="size-6 text-white" />
    </div>
  );
}
