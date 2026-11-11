import { useTranslations } from "@teak/i18n/react";
import { useRef } from "react";
import { ResilientMediaImage, useMediaUrlRecovery } from "@/components/media";
import type { ClientCard } from "@/lib/cardTypes";
import { isGifCard } from "@/lib/cardTypes";

interface VideoPreviewProps {
  card: ClientCard;
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
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!fileUrl) {
    return null;
  }

  if (isGifCard(card)) {
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
      // A link that expires mid-playback fails here, not on <source>.
      onError={(event) => void media.onError(event.currentTarget)}
      // A refreshed link carries on from where the old one stopped.
      onLoadedMetadata={(event) => media.resume(event.currentTarget)}
      preload="metadata"
      ref={videoRef}
    >
      <source
        onError={() => void media.onError(videoRef.current)}
        src={fileUrl}
        type={card.fileMetadata?.mimeType}
      />
      <track kind="captions" />
      {t("unsupported")}
    </video>
  );
}
