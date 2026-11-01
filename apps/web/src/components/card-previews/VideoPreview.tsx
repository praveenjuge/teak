import type { Doc } from "@teak/convex/_generated/dataModel";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { useTranslations } from "@teak/i18n/react";
import { ResilientMediaImage } from "@/components/cards/previews/ResilientMediaImage";
import { useMediaUrlRecovery } from "@/components/cards/previews/useMediaUrlRecovery";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface VideoPreviewProps {
  card: CardWithUrls;
}

export function VideoPreview({ card }: VideoPreviewProps) {
  const t = useTranslations("cardPreviews.video");
  // A dialog left open can outlive its signed URL; this asks for a new one.
  const media = useMediaUrlRecovery({
    cardId: card._id,
    src: card.fileUrl,
    storageKey: card.fileKey,
  });
  const fileUrl = media.src;

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
      <ResilientMediaImage
        alt={card.fileMetadata?.fileName || card.content || t("gifAlt")}
        cardId={card._id}
        className="h-full w-full rounded-xl object-contain"
        height={480}
        src={fileUrl}
        storageKey={card.fileKey}
        width={640}
      />
    );
  }

  return (
    <video
      autoPlay
      className="h-full w-full rounded-xl bg-black object-contain"
      controls
      // A new URL needs a new element: a <source> change doesn't reload.
      key={fileUrl}
      preload="metadata"
    >
      <source
        onError={() => void media.onError()}
        src={fileUrl}
        type={card.fileMetadata?.mimeType}
      />
      <track kind="captions" />
      {t("unsupported")}
    </video>
  );
}
