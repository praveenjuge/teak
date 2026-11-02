import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { useState } from "react";
import { ResilientMediaImage } from "@/components/cards/previews/ResilientMediaImage";
import { cn } from "@/lib/utils";

type CardWithUrls = Doc<"cards"> & {
  detailUrl?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface ImagePreviewProps {
  card: CardWithUrls;
}

const TALL_IMAGE_RATIO = 1.5;

/**
 * What the image shows, for its alt text: the card's own text, then Teak's
 * description of it, then its file name. "Image" only when there is none.
 */
export const imageAltText = (
  card: Pick<CardWithUrls, "aiSummary" | "content" | "fileMetadata">,
  fallback: string
): string =>
  [card.content, card.aiSummary, card.fileMetadata?.fileName]
    .map((value) => value?.trim())
    .find(Boolean) ?? fallback;

/** Pulses where the media will be until it has loaded. */
export const MEDIA_LOADING_CLASS = "animate-pulse bg-muted";

// An image that hasn't loaded has no size yet (it's sized by its pixels), so
// the placeholder fills the stage behind it instead.
function MediaLoading() {
  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0 rounded-md", MEDIA_LOADING_CLASS)}
      data-slot="media-loading"
    />
  );
}

export function ImagePreview({ card }: ImagePreviewProps) {
  const t = useTranslations("cardPreviews.image");
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const imageAlt = imageAltText(card, t("alt"));
  const fileUrl = card.detailUrl ?? card.thumbnailUrl ?? card.fileUrl;
  const imageWidth = card.fileMetadata?.width;
  const imageHeight = card.fileMetadata?.height;
  const isTallImage =
    typeof imageWidth === "number" &&
    typeof imageHeight === "number" &&
    imageWidth > 0 &&
    imageHeight / imageWidth >= TALL_IMAGE_RATIO;

  const unavailable = (
    <p className="text-muted-foreground text-sm">
      {card.fileMetadata?.fileName || t("unavailable")}
    </p>
  );
  if (!fileUrl) {
    return unavailable;
  }
  // A dialog left open can outlive its signed URL; this asks for a new one.
  const recovery = {
    cardId: card._id,
    fallback: unavailable,
    onLoad: () => setLoadedUrl(fileUrl),
    // A load that failed for good is over too: the fallback shows instead.
    onPermanentError: () => setLoadedUrl(fileUrl),
    storageKey: card.fileKey,
  };
  const loading = loadedUrl !== fileUrl;

  if (isTallImage) {
    return (
      <div className="relative flex min-h-full w-full max-w-3xl items-start justify-center self-start">
        {loading ? <MediaLoading /> : null}
        <ResilientMediaImage
          {...recovery}
          alt={imageAlt}
          className="relative block h-auto w-full rounded-md object-contain shadow-sm"
          data-fit="width"
          data-loading={loading || undefined}
          height={imageHeight}
          src={fileUrl}
          width={imageWidth}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {loading ? <MediaLoading /> : null}
      <ResilientMediaImage
        {...recovery}
        alt={imageAlt}
        className="relative block h-auto max-h-[60dvh] w-auto max-w-full rounded-md object-contain shadow-sm md:max-h-full"
        data-fit="contain"
        data-loading={loading || undefined}
        height={imageHeight}
        src={fileUrl}
        width={imageWidth}
      />
    </div>
  );
}
