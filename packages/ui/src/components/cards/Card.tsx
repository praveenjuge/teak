import { CardContent, Card as UICard } from "@teak/ui/components/ui/card";
import { Checkbox } from "@teak/ui/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@teak/ui/components/ui/context-menu";
import { Image } from "antd";
import {
  CheckSquare,
  Copy,
  ExternalLink,
  Heart,
  Loader2,
  RotateCcw,
  Tag,
  Trash,
  Trash2,
} from "lucide-react";
import type { SyntheticEvent } from "react";
import { memo, useState } from "react";
import { AudioWavePreview } from "./previews/AudioWavePreview";
import { GridDocumentPreview } from "./previews/GridDocumentPreview";
import { GridImagePreview } from "./previews/GridImagePreview";
import { GridVideoPreview } from "./previews/GridVideoPreview";
import type { CardProps, LinkPreviewMetadata } from "./types";
import { isOptimisticCard } from "./types";

export type { CardProps, CardWithUrls, LinkPreviewMetadata } from "./types";
export { isOptimisticCard } from "./types";

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
    let contentToCopy = "";
    let isImage = false;
    if (card.type === "image") {
      isImage = true;
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

  const renderCardContent = () => {
    if (card.type === "text") {
      return (
        <div className="rounded-xl border bg-card p-4">
          <p className="line-clamp-2 font-medium">
            {card.content || card.fileMetadata?.fileName}
          </p>
        </div>
      );
    }

    if (card.type === "quote") {
      return (
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
      );
    }

    if (card.type === "link") {
      if (displayLinkImage && displayLinkImageSize) {
        return (
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
              <p className="max-w-full truncate font-medium">{linkCardTitle}</p>
            </div>
          </div>
        );
      }

      if (legacyDisplayImage) {
        return (
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
              <p className="max-w-full truncate font-medium">{linkCardTitle}</p>
            </div>
          </div>
        );
      }

      return (
        <p className="w-full min-w-0 overflow-hidden truncate text-ellipsis whitespace-nowrap rounded-xl border bg-card p-4 font-medium">
          {card.content || linkCardTitle}
        </p>
      );
    }

    if (card.type === "image") {
      return (
        <GridImagePreview
          altText={card.content}
          height={card.fileMetadata?.height}
          imageUrl={card.thumbnailUrl ?? card.fileUrl ?? undefined}
          width={card.fileMetadata?.width}
        />
      );
    }

    if (card.type === "video") {
      return <GridVideoPreview thumbnailUrl={card.thumbnailUrl ?? undefined} />;
    }

    if (card.type === "audio") {
      return <AudioWavePreview cardId={card._id} />;
    }

    if (card.type === "document") {
      return (
        <GridDocumentPreview
          fileName={card.fileMetadata?.fileName || card.content}
          thumbnailUrl={card.thumbnailUrl ?? undefined}
        />
      );
    }

    if (card.type === "palette") {
      if (card.colors?.length) {
        return (
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
        );
      }

      return (
        <div className="rounded-xl border bg-card p-4">
          <p className="line-clamp-2 font-medium">{card.content}</p>
        </div>
      );
    }

    return (
      <div className="rounded-xl border bg-card p-4">
        <p className="line-clamp-2 font-medium">
          {card.content || card.fileMetadata?.fileName}
        </p>
      </div>
    );
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
            {renderCardContent()}
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
