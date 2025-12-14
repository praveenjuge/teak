import { type Doc } from "@teak/convex/_generated/dataModel";

interface VideoPreviewProps {
  card: Doc<"cards"> & { fileUrl?: string };
}

export function VideoPreview({ card }: VideoPreviewProps) {
  const fileUrl = card.fileUrl;

  if (!fileUrl) return null;

  return (
    <video
      controls
      className="w-full bg-black h-full object-contain rounded-lg"
      preload="metadata"
      autoPlay
    >
      <source src={fileUrl} type={card.fileMetadata?.mimeType} />
      Your browser does not support the video tag.
    </video>
  );
}
