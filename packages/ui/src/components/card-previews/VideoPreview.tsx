import type { Doc } from "@teak/convex/_generated/dataModel";
import { inferFileFormat } from "@teak/convex/shared/file-formats";

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

  const format = card.fileMetadata?.fileName
    ? inferFileFormat({
        fileName: card.fileMetadata.fileName,
        mimeType: card.fileMetadata.mimeType,
      })
    : null;

  if (format?.id === "gif") {
    return (
      <img
        alt={card.fileMetadata?.fileName || card.content || "Animated GIF"}
        className="h-full w-full rounded-lg object-contain"
        height={480}
        src={fileUrl}
        width={640}
      />
    );
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
