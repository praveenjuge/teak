import { formatDuration, getFileFormatBadge } from "./cardDisplay";
import { AudioWavePreview } from "./previews/AudioWavePreview";
import { GridDocumentPreview } from "./previews/GridDocumentPreview";
import { GridImagePreview } from "./previews/GridImagePreview";
import { GridVideoPreview } from "./previews/GridVideoPreview";
import type { CardWithUrls } from "./types";

interface FileCardBodyProps {
  card: CardWithUrls;
  /** Above-the-fold card: its media loads eagerly with high priority. */
  isPriority: boolean;
}

export function ImageCardBody({ card, isPriority }: FileCardBodyProps) {
  return (
    <GridImagePreview
      altText={card.content}
      cardId={card._id}
      compactUrl={card.compactUrl}
      height={card.fileMetadata?.height}
      imageUrl={
        card.thumbnailUrl ?? card.compactUrl ?? card.fileUrl ?? undefined
      }
      isPriority={isPriority}
      placeholderColor={card.colors?.[0]?.hex}
      storageKey={card.fileKey}
      width={card.fileMetadata?.width}
    />
  );
}

export function VideoCardBody({ card, isPriority }: FileCardBodyProps) {
  const isGif =
    card.fileMetadata?.mimeType === "image/gif" ||
    (card.fileMetadata?.fileName?.toLowerCase().endsWith(".gif") ?? false);
  return (
    <GridVideoPreview
      cardId={card._id}
      height={card.fileMetadata?.height}
      isGif={isGif}
      isPriority={isPriority}
      scrub={card.fileMetadata?.scrub}
      scrubKey={card.scrubKey}
      scrubUrl={card.scrubUrl}
      thumbnailKey={card.thumbnailKey}
      thumbnailUrl={card.thumbnailUrl ?? undefined}
      videoKey={card.fileKey}
      videoUrl={card.fileUrl ?? undefined}
      width={card.fileMetadata?.width}
    />
  );
}

export function AudioCardBody({ card }: Pick<FileCardBodyProps, "card">) {
  return (
    <AudioWavePreview
      cardId={card._id}
      durationLabel={formatDuration(card.fileMetadata?.duration)}
      title={card.metadataTitle || card.fileMetadata?.fileName || "Recording"}
      waveformGrid={card.fileMetadata?.waveform?.grid}
    />
  );
}

export function DocumentCardBody({ card, isPriority }: FileCardBodyProps) {
  return (
    <GridDocumentPreview
      cardId={card._id}
      fileName={card.fileMetadata?.fileName || card.content}
      formatBadge={getFileFormatBadge(
        card.fileMetadata?.fileName,
        card.fileMetadata?.mimeType
      )}
      height={card.fileMetadata?.height}
      isPriority={isPriority}
      thumbnailKey={card.thumbnailKey}
      thumbnailUrl={card.thumbnailUrl ?? undefined}
      width={card.fileMetadata?.width}
    />
  );
}
