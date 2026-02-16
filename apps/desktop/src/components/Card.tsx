import type { Doc } from "@teak/convex/_generated/dataModel";
import { CardContent, Card as UICard } from "@teak/ui/components/ui/card";
import { Image } from "antd";
import { File, Heart, Play } from "lucide-react";
import type { SyntheticEvent } from "react";
import { memo, useState } from "react";

export type DesktopCard = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

type LinkPreviewMetadata = NonNullable<
  Doc<"cards">["metadata"]
>["linkPreview"] & {
  imageWidth?: number;
  imageHeight?: number;
  screenshotWidth?: number;
  screenshotHeight?: number;
};

interface CardProps {
  card: DesktopCard;
  onClick?: (card: DesktopCard) => void;
}

const AUDIO_WAVE_BARS = 45;
const AUDIO_WAVE_BAR_WIDTH_PX = 2;
const AUDIO_WAVE_MIN_HEIGHT = 20;
const AUDIO_WAVE_MAX_VARIATION = 60;

function seededRandom(seed: string, index: number): number {
  const hash = seed.split("").reduce((accumulator, character) => {
    const next = (accumulator << 5) - accumulator + character.charCodeAt(0);
    return next & next;
  }, index);
  return Math.abs(Math.sin(hash)) * 0.6 + 0.2;
}

function getAudioWaveHeight(seed: string, index: number): string {
  const height =
    seededRandom(seed, index) * AUDIO_WAVE_MAX_VARIATION +
    AUDIO_WAVE_MIN_HEIGHT;
  return `${Number(height.toFixed(3))}%`;
}

export const Card = memo(function Card({ card, onClick }: CardProps) {
  const handleClick = () => {
    onClick?.(card);
  };

  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? (card.metadata.linkPreview as LinkPreviewMetadata)
      : undefined;
  const linkCardTitle =
    linkPreview?.title ||
    card.metadataTitle ||
    card.url ||
    card.content ||
    "Link";
  const linkCardImage = card.linkPreviewImageUrl ?? linkPreview?.imageUrl;
  const resolvedScreenshotUrl =
    typeof card.screenshotUrl === "string" ? card.screenshotUrl : undefined;

  const [useFallbackImage, setUseFallbackImage] = useState(false);

  const primaryImageSize =
    typeof linkPreview?.imageWidth === "number" &&
    typeof linkPreview?.imageHeight === "number"
      ? { width: linkPreview.imageWidth, height: linkPreview.imageHeight }
      : undefined;
  const fallbackImageSize =
    typeof linkPreview?.screenshotWidth === "number" &&
    typeof linkPreview?.screenshotHeight === "number"
      ? {
          width: linkPreview.screenshotWidth,
          height: linkPreview.screenshotHeight,
        }
      : undefined;

  const hasPrimaryImage = !!(linkCardImage && primaryImageSize);
  const hasFallbackImage = !!(resolvedScreenshotUrl && fallbackImageSize);
  const canFallbackImage = !!resolvedScreenshotUrl;
  const shouldUseFallback = useFallbackImage || !hasPrimaryImage;

  const displayLinkImage = shouldUseFallback
    ? hasFallbackImage
      ? resolvedScreenshotUrl
      : undefined
    : hasPrimaryImage
      ? linkCardImage
      : undefined;

  const displayLinkImageSize = shouldUseFallback
    ? hasFallbackImage
      ? fallbackImageSize
      : undefined
    : hasPrimaryImage
      ? primaryImageSize
      : undefined;

  const legacyPrimaryImage = linkCardImage;
  const legacyFallbackImage = resolvedScreenshotUrl;
  const legacyDisplayImage = useFallbackImage
    ? (legacyFallbackImage ?? undefined)
    : (legacyPrimaryImage ?? legacyFallbackImage ?? undefined);

  const handleLinkImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    if (
      !useFallbackImage &&
      canFallbackImage &&
      resolvedScreenshotUrl &&
      target.src !== resolvedScreenshotUrl
    ) {
      setUseFallbackImage(true);
      return;
    }

    target.style.display = "none";
  };

  return (
    <UICard
      className="relative cursor-pointer overflow-hidden rounded-none border-0 bg-transparent p-0 contain-content"
      onClick={handleClick}
    >
      {card.isFavorited && (
        <div className="absolute top-3 right-3 z-10">
          <Heart className="size-4 fill-destructive text-destructive" />
        </div>
      )}

      <CardContent className="space-y-2 p-0">
        {card.type === "text" && (
          <div className="rounded-xl border bg-card p-4">
            <p className="line-clamp-2 font-medium">
              {card.content || card.fileMetadata?.fileName}
            </p>
          </div>
        )}

        {card.type === "quote" && (
          <div className="rounded-xl border bg-card px-6 py-4">
            <p className="line-clamp-2 text-balance text-center font-medium italic leading-relaxed">
              {card.content}
            </p>
          </div>
        )}

        {card.type === "link" &&
          (displayLinkImage && displayLinkImageSize ? (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              <div
                className="w-full overflow-hidden"
                style={{
                  aspectRatio:
                    displayLinkImageSize.width / displayLinkImageSize.height,
                }}
              >
                <Image
                  alt={linkCardTitle}
                  className="h-full w-full object-cover"
                  onError={handleLinkImageError}
                  placeholder
                  preview={false}
                  rootClassName="h-full w-full"
                  src={displayLinkImage}
                />
              </div>
              <div className="px-4 py-3">
                <p className="max-w-full truncate font-medium">
                  {linkCardTitle}
                </p>
              </div>
            </div>
          ) : legacyDisplayImage ? (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              <div className="h-28 min-h-28 overflow-hidden">
                <Image
                  alt={linkCardTitle}
                  className="h-full w-full object-cover"
                  onError={handleLinkImageError}
                  placeholder
                  preview={false}
                  rootClassName="h-full w-full"
                  src={legacyDisplayImage}
                />
              </div>
              <div className="px-4 py-3">
                <p className="max-w-full truncate font-medium">
                  {linkCardTitle}
                </p>
              </div>
            </div>
          ) : (
            <p className="truncate rounded-xl border bg-card p-4 font-medium">
              {card.content || linkCardTitle}
            </p>
          ))}

        {card.type === "image" && (
          <GridImagePreview
            altText={card.content}
            height={card.fileMetadata?.height}
            imageUrl={card.thumbnailUrl ?? card.fileUrl ?? undefined}
            width={card.fileMetadata?.width}
          />
        )}

        {card.type === "video" && (
          <GridVideoPreview thumbnailUrl={card.thumbnailUrl ?? undefined} />
        )}

        {card.type === "audio" && (
          <div className="flex h-14 items-center justify-between space-x-0.5 rounded-xl border bg-card px-4 py-2">
            {Array.from({ length: AUDIO_WAVE_BARS }).map((_, index) => (
              <div
                className="rounded-full bg-muted-foreground"
                key={`${card._id}-bar-${index}`}
                style={{
                  width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
                  height: getAudioWaveHeight(card._id, index),
                }}
              />
            ))}
          </div>
        )}

        {card.type === "document" && (
          <GridDocumentPreview
            fileName={card.fileMetadata?.fileName || card.content}
            thumbnailUrl={card.thumbnailUrl ?? undefined}
          />
        )}

        {card.type === "palette" &&
          (card.colors?.length ? (
            <div className="flex overflow-hidden rounded-xl border bg-card">
              {card.colors.slice(0, 12).map((color, index) => (
                <div
                  className="h-14 min-w-0 flex-1"
                  key={`${color.hex}-${index}`}
                  style={{ backgroundColor: color.hex }}
                  title={color.hex}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-4">
              <p className="line-clamp-2 font-medium">{card.content}</p>
            </div>
          ))}
      </CardContent>
    </UICard>
  );
});

function GridImagePreview({
  imageUrl,
  altText,
  width,
  height,
}: {
  imageUrl?: string;
  altText?: string;
  width?: number;
  height?: number;
}) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
      style={{ aspectRatio: width && height ? width / height : 4 / 3 }}
    >
      {imageUrl ? (
        <Image
          alt={altText ?? "Image"}
          className="h-full w-full object-cover"
          loading="lazy"
          placeholder
          preview={false}
          rootClassName="h-full w-full"
          src={imageUrl}
        />
      ) : null}
    </div>
  );
}

function GridDocumentPreview({
  thumbnailUrl,
  fileName,
}: {
  thumbnailUrl?: string;
  fileName?: string;
}) {
  if (thumbnailUrl) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <Image
          alt={`Preview of ${fileName || "document"}`}
          className="w-full bg-muted object-contain"
          loading="lazy"
          placeholder
          preview={false}
          src={thumbnailUrl}
        />
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <File className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{fileName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-4">
      <File className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{fileName}</span>
    </div>
  );
}

function GridVideoPreview({ thumbnailUrl }: { thumbnailUrl?: string }) {
  if (thumbnailUrl) {
    return (
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <Image
          alt="Video thumbnail"
          className="w-full object-cover"
          loading="lazy"
          placeholder
          preview={false}
          src={thumbnailUrl}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-black/50 p-2">
            <Play className="size-6 text-white" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-32 w-full items-center justify-center rounded-xl border bg-black text-white">
      <Play className="size-6 text-white" />
    </div>
  );
}
