import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";

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

export function ImagePreview({ card }: ImagePreviewProps) {
  const t = useTranslations("cardPreviews.image");
  const imageAlt = imageAltText(card, t("alt"));
  const fileUrl = card.detailUrl ?? card.thumbnailUrl ?? card.fileUrl;
  const imageWidth = card.fileMetadata?.width;
  const imageHeight = card.fileMetadata?.height;
  const isTallImage =
    typeof imageWidth === "number" &&
    typeof imageHeight === "number" &&
    imageWidth > 0 &&
    imageHeight / imageWidth >= TALL_IMAGE_RATIO;

  if (!fileUrl) {
    return (
      <p className="text-muted-foreground text-sm">
        {card.fileMetadata?.fileName || t("unavailable")}
      </p>
    );
  }

  if (isTallImage) {
    return (
      <div className="flex min-h-full w-full max-w-3xl items-start justify-center self-start">
        <img
          alt={imageAlt}
          className="block h-auto w-full rounded-md object-contain shadow-sm"
          data-fit="width"
          height={imageHeight}
          src={fileUrl}
          width={imageWidth}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <img
        alt={imageAlt}
        className="block h-auto max-h-[60dvh] w-auto max-w-full rounded-md object-contain shadow-sm md:max-h-full"
        data-fit="contain"
        height={imageHeight}
        src={fileUrl}
        width={imageWidth}
      />
    </div>
  );
}
