import type { Doc } from "@teak/convex/_generated/dataModel";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface VideoPreviewProps {
  card: CardWithUrls;
}

export function VideoPreview({ card }: VideoPreviewProps) {
  const fileUrl = card.fileUrl;

  if (!fileUrl) {
    return null;
  }

  return (
    <video
      autoPlay
      className="h-full w-full rounded-lg bg-black object-contain"
      controls
      key={fileUrl}
      playsInline
      preload="metadata"
      src={fileUrl}
    >
      <track kind="captions" />
      Your browser does not support the video tag.
    </video>
  );
}
