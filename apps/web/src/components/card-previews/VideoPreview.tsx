import type { Doc } from "@teak/convex/_generated/dataModel";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { useTranslations } from "@teak/i18n/react";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface VideoPreviewProps {
  card: CardWithUrls;
}

export function VideoPreview({ card }: VideoPreviewProps) {
  const t = useTranslations("cardPreviews.video");
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
        alt={card.fileMetadata?.fileName || card.content || t("gifAlt")}
        className="h-full w-full rounded-xl object-contain"
        height={480}
        src={fileUrl}
        width={640}
      />
    );
  }

  return (
    <video
      autoPlay
      className="h-full w-full rounded-xl bg-black object-contain"
      controls
      preload="metadata"
    >
      <source src={fileUrl} type={card.fileMetadata?.mimeType} />
      <track kind="captions" />
      {t("unsupported")}
    </video>
  );
}
