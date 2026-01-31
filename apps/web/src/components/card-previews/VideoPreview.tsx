import type { Doc } from "@teak/convex/_generated/dataModel";

interface VideoPreviewProps {
  card: Doc<"cards"> & { fileUrl?: string };
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
      preload="metadata"
    >
      <source src={fileUrl} type={card.fileMetadata?.mimeType} />
      <track kind="captions" />
      Your browser does not support the video tag.
    </video>
  );
}
