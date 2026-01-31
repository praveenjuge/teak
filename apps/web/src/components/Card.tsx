import type { Doc } from "@teak/convex/_generated/dataModel";
import { Image } from "antd";
import {
  CheckSquare,
  Copy,
  ExternalLink,
  File,
  Heart,
  Loader2,
  Play,
  RotateCcw,
  Tag,
  Trash,
  Trash2,
} from "lucide-react";
import type { SyntheticEvent } from "react";
import { memo, useEffect, useState } from "react";
import { CardContent, Card as UICard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (36 chars with dashes)
// Convex IDs don't have this format, so we can use this to detect optimistic cards
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isOptimisticCard(cardId: string): boolean {
  return UUID_REGEX.test(cardId);
}

type CardWithUrls = Doc<"cards"> & {
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
  card: CardWithUrls;
  onClick?: (card: CardWithUrls) => void;
  onDelete?: (cardId: string) => void;
  onRestore?: (cardId: string) => void;
  onPermanentDelete?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
  onAddTags?: (cardId: string) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  isTrashMode?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onEnterSelectionMode?: (cardId: string) => void;
  onToggleSelection?: () => void;
}

const AUDIO_WAVE_BARS = 45;
const AUDIO_WAVE_BAR_WIDTH_PX = 2;
const AUDIO_WAVE_MIN_HEIGHT = 20;
const AUDIO_WAVE_MAX_VARIATION = 60;

// Simple seeded random function for consistent wave patterns
function seededRandom(seed: string, index: number): number {
  const hash = seed.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, index);
  return Math.abs(Math.sin(hash)) * 0.6 + 0.2; // Returns value between 0.2 and 0.8
}

function getAudioWaveHeight(seed: string, index: number): string {
  const height =
    seededRandom(seed, index) * AUDIO_WAVE_MAX_VARIATION +
    AUDIO_WAVE_MIN_HEIGHT;
  return `${Number(height.toFixed(3))}%`;
}

export const Card = memo(function Card({
  card,
  onClick,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggleFavorite,
  onAddTags,
  onCopyImage,
  isSelectionMode,
  isSelected,
  onEnterSelectionMode,
  onToggleSelection,
}: CardProps) {
  const isOptimistic = isOptimisticCard(card._id);

  const handleClick = () => {
    // Don't allow clicking on optimistic cards (not yet saved to server)
    if (isOptimistic) {
      return;
    }
    onClick?.(card);
  };

  const handleDelete = () => {
    if (isOptimistic) {
      return;
    }
    onDelete?.(card._id);
  };

  const handleRestore = () => {
    if (isOptimistic) {
      return;
    }
    onRestore?.(card._id);
  };

  const handlePermanentDelete = () => {
    if (isOptimistic) {
      return;
    }
    onPermanentDelete?.(card._id);
  };

  const handleToggleFavorite = () => {
    if (isOptimistic) {
      return;
    }
    onToggleFavorite?.(card._id);
  };

  const handleAddTags = () => {
    if (isOptimistic) {
      return;
    }
    onAddTags?.(card._id);
  };

  const handleCopyImage = () => {
    if (isOptimistic) {
      return;
    }
    // For image cards: the parent will handle copying the actual image
    // For text cards: copy the content
    // For link cards: copy the URL
    let contentToCopy = "";
    let isImage = false;
    if (card.type === "image") {
      isImage = true;
      // Use original fileUrl, not thumbnail
      contentToCopy = card.fileUrl ?? card.thumbnailUrl ?? "";
    } else if (card.type === "text") {
      contentToCopy = card.content ?? "";
    } else if (card.type === "link" && card.url) {
      contentToCopy = card.url;
    }
    if (contentToCopy) {
      onCopyImage?.(contentToCopy, isImage);
    }
  };

  const openLink = () => {
    if (card.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleSelect = () => {
    if (isOptimistic) {
      return;
    }
    onEnterSelectionMode?.(card._id);
  };

  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? (card.metadata.linkPreview as LinkPreviewMetadata)
      : undefined;
  const linkCardTitle =
    linkPreview?.title || card.metadataTitle || card.url || "Link";
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

  useEffect(() => {
    setUseFallbackImage(false);
  }, []);

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
    } else {
      target.style.display = "none";
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={isOptimistic}>
        <UICard
          className={`relative overflow-hidden rounded-none border-0 bg-transparent p-0 contain-content ${
            isOptimistic ? "cursor-default opacity-70" : "cursor-pointer"
          } ${card.isDeleted ? "opacity-60" : ""} ${isSelected ? "rounded-xl ring-2 ring-primary" : ""}`}
          onClick={handleClick}
        >
          {isOptimistic && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {isSelectionMode && !isOptimistic && (
            <div className="absolute top-3 left-3 z-10">
              <Checkbox
                checked={isSelected}
                className="pointer-events-none select-auto"
              />
            </div>
          )}
          {card.isFavorited && !isOptimistic && (
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
                <div className="relative">
                  <p className="line-clamp-2 text-balance text-center font-medium italic leading-relaxed">
                    {card.content}
                  </p>
                  <div className="pointer-events-none absolute -top-3.5 -left-4 select-none font-serif text-4xl text-muted-foreground/20 leading-none">
                    &ldquo;
                  </div>
                  <div className="pointer-events-none absolute -right-4 -bottom-7 select-none font-serif text-4xl text-muted-foreground/20 leading-none">
                    &rdquo;
                  </div>
                </div>
              </div>
            )}
            {card.type === "link" &&
              (displayLinkImage && displayLinkImageSize ? (
                <div className="divide-y overflow-hidden rounded-xl border bg-card">
                  <div
                    className="w-full overflow-hidden"
                    style={{
                      aspectRatio:
                        displayLinkImageSize.width /
                        displayLinkImageSize.height,
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
                <p className="w-full min-w-0 overflow-hidden truncate text-ellipsis whitespace-nowrap rounded-xl border bg-card p-4 font-medium">
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
                {Array.from({ length: AUDIO_WAVE_BARS }).map((_, i) => (
                  <div
                    className="rounded-full bg-muted-foreground"
                    key={i}
                    style={{
                      width: `${AUDIO_WAVE_BAR_WIDTH_PX}px`,
                      height: getAudioWaveHeight(card._id, i),
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
                  {card.colors?.slice(0, 12).map((color, index) => (
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
            {!card.type && (
              <div className="rounded-xl border bg-card p-4">
                <p className="line-clamp-2 font-medium">
                  {card.content || card.fileMetadata?.fileName}
                </p>
              </div>
            )}
          </CardContent>
        </UICard>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        {card.url && (
          <ContextMenuItem onClick={openLink}>
            <ExternalLink />
            Open Link
          </ContextMenuItem>
        )}

        {/* Copy to Clipboard - for image (non-SVG), text, and link cards */}
        {!card.isDeleted &&
          (card.type === "text" ||
            card.type === "link" ||
            (card.type === "image" &&
              card.fileMetadata?.mimeType !== "image/svg+xml")) && (
            <ContextMenuItem onClick={handleCopyImage}>
              <Copy />
              {card.type === "text"
                ? "Copy Text"
                : card.type === "link"
                  ? "Copy Link"
                  : "Copy Image"}
            </ContextMenuItem>
          )}

        {!card.isDeleted && (
          <>
            {!isSelectionMode && (
              <ContextMenuItem onClick={handleSelect}>
                <CheckSquare />
                Select
              </ContextMenuItem>
            )}
            {isSelectionMode && (
              <ContextMenuItem onClick={onToggleSelection}>
                <CheckSquare />
                {isSelected ? "Deselect" : "Select"}
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={handleAddTags}>
              <Tag />
              Add Tags
            </ContextMenuItem>
            <ContextMenuItem onClick={handleToggleFavorite}>
              <Heart
                className={`${
                  card.isFavorited ? "fill-destructive text-destructive" : ""
                }`}
              />
              {card.isFavorited ? "Unfavorite" : "Favorite"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleDelete}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}

        {card.isDeleted && (
          <>
            <ContextMenuItem onClick={handleRestore}>
              <RotateCcw />
              Restore
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handlePermanentDelete}>
              <Trash />
              Delete Forever
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
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
      {imageUrl && (
        <Image
          alt={altText ?? "Image"}
          className="h-full w-full object-cover"
          loading="lazy"
          placeholder
          preview={false}
          rootClassName="h-full w-full"
          src={imageUrl}
          style={{ objectFit: "cover" }}
        />
      )}
      {!imageUrl && (
        <Image
          alt=""
          className="h-full! w-full scale-105"
          placeholder
          rootClassName="h-full w-full"
        />
      )}
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

  // Fallback: show icon-based display (for non-PDF documents or if thumbnail not ready)
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-4">
      <File className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{fileName}</span>
    </div>
  );
}

function GridVideoPreview({ thumbnailUrl }: { thumbnailUrl?: string }) {
  // If we have a thumbnail, show it with a play icon overlay
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

  // Fallback: show icon-based display (if thumbnail not ready)
  return (
    <div className="flex h-32 w-full items-center justify-center rounded-xl border bg-black text-white">
      <Play className="size-6 text-white" />
    </div>
  );
}
