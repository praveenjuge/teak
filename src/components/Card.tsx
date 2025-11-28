import {
  CheckSquare,
  ExternalLink,
  File,
  Heart,
  Loader2,
  PlayCircle,
  RotateCcw,
  Trash,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { Id } from "@teak/convex/_generated/dataModel";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Card as UICard, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { type Doc } from "@teak/convex/_generated/dataModel";

// UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (36 chars with dashes)
// Convex IDs don't have this format, so we can use this to detect optimistic cards
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isOptimisticCard(cardId: string): boolean {
  return UUID_REGEX.test(cardId);
}

interface CardProps {
  card: Doc<"cards">;
  onClick?: (card: Doc<"cards">) => void;
  onDelete?: (cardId: string) => void;
  onRestore?: (cardId: string) => void;
  onPermanentDelete?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
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

export function Card({
  card,
  onClick,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggleFavorite,
  isSelectionMode,
  isSelected,
  onEnterSelectionMode,
  onToggleSelection,
}: CardProps) {
  const isOptimistic = isOptimisticCard(card._id);

  const handleClick = () => {
    // Don't allow clicking on optimistic cards (not yet saved to server)
    if (isOptimistic) return;
    onClick?.(card);
  };

  const handleDelete = () => {
    if (isOptimistic) return;
    onDelete?.(card._id);
  };

  const handleRestore = () => {
    if (isOptimistic) return;
    onRestore?.(card._id);
  };

  const handlePermanentDelete = () => {
    if (isOptimistic) return;
    onPermanentDelete?.(card._id);
  };

  const handleToggleFavorite = () => {
    if (isOptimistic) return;
    onToggleFavorite?.(card._id);
  };

  const openLink = () => {
    if (card.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleSelect = () => {
    if (isOptimistic) return;
    onEnterSelectionMode?.(card._id);
  };

  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const linkCardTitle = linkPreview?.title || card.metadataTitle || card.url;
  const linkCardImage = linkPreview?.imageUrl;
  const screenshotStorageId = linkPreview?.screenshotStorageId;
  const screenshotUrl = useQuery(
    api.cards.getFileUrl,
    screenshotStorageId
      ? { fileId: screenshotStorageId, cardId: card._id }
      : "skip"
  );
  const resolvedScreenshotUrl =
    typeof screenshotUrl === "string" ? screenshotUrl : undefined;
  const [useFallbackImage, setUseFallbackImage] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUseFallbackImage(false);
  }, [card._id, linkCardImage, resolvedScreenshotUrl]);

  const displayLinkImage = useFallbackImage
    ? (resolvedScreenshotUrl ?? undefined)
    : (linkCardImage ?? resolvedScreenshotUrl);

  const handleLinkImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    if (
      !useFallbackImage &&
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
          className={`bg-transparent rounded-none border-0 relative p-0 overflow-hidden ${
            isOptimistic ? "opacity-70 cursor-default" : "cursor-pointer"
          } ${card.isDeleted ? "opacity-60" : ""} ${isSelected ? "ring-2 ring-primary rounded-xl" : ""}`}
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
                className="select-auto pointer-events-none"
              />
            </div>
          )}
          {card.isFavorited && !isOptimistic && (
            <div className="absolute top-3 right-3 z-10">
              <Heart className="size-4 fill-destructive text-destructive" />
            </div>
          )}

          <CardContent className="p-0 space-y-2">
            {card.type === "text" && (
              <div className="p-4 rounded-xl border bg-card">
                <p className="line-clamp-2 font-medium">
                  {card.content || card.fileMetadata?.fileName}
                </p>
              </div>
            )}
            {card.type === "quote" && (
              <div className="py-4 px-6 rounded-xl border bg-card">
                <div className="relative">
                  <p className="line-clamp-2 font-medium italic leading-relaxed text-center text-balance">
                    {card.content}
                  </p>
                  <div className="absolute select-none pointer-events-none -left-4 -top-3.5 text-4xl text-muted-foreground/20 leading-none font-serif">
                    &ldquo;
                  </div>
                  <div className="absolute select-none pointer-events-none -right-4 -bottom-7 text-4xl text-muted-foreground/20 leading-none font-serif">
                    &rdquo;
                  </div>
                </div>
              </div>
            )}
            {card.type === "link" && (
              <>
                {displayLinkImage && linkCardTitle ? (
                  <div className="rounded-xl border bg-card overflow-hidden divide-y">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={displayLinkImage}
                      alt={linkCardTitle}
                      className="w-full h-28 object-cover bg-card"
                      onError={handleLinkImageError}
                    />
                    <div className="px-4 py-3">
                      <p className="line-clamp-1 font-medium truncate">
                        {linkCardTitle}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border bg-card">
                    <p className="line-clamp-2 font-medium">
                      {card.content || linkCardTitle}
                    </p>
                  </div>
                )}
              </>
            )}
            {card.type === "image" && (
              <GridImagePreview
                fileId={card.fileId}
                thumbnailId={card.thumbnailId}
                altText={card.content}
                width={card.fileMetadata?.width}
                height={card.fileMetadata?.height}
              />
            )}
            {card.type === "video" && (
              <GridVideoPreview
                fileId={card.fileId}
                thumbnailId={card.thumbnailId}
              />
            )}
            {card.type === "audio" && (
              <div className="flex h-14 items-center justify-between space-x-0.5 px-4 py-2 bg-card rounded-xl border">
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
                thumbnailId={card.thumbnailId}
                fileName={card.fileMetadata?.fileName || card.content}
              />
            )}
            {card.type === "palette" &&
              (card.colors?.length ? (
                <div className="flex bg-card rounded-xl border overflow-hidden">
                  {card.colors?.slice(0, 12).map((color, index) => (
                    <div
                      key={`${color.hex}-${index}`}
                      className="h-14 flex-1 min-w-0"
                      style={{ backgroundColor: color.hex }}
                      title={color.hex}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl border bg-card">
                  <p className="line-clamp-2 font-medium">{card.content}</p>
                </div>
              ))}
            {!card.type && (
              <div className="p-4 rounded-xl border bg-card">
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
          <>
            <ContextMenuItem onClick={openLink}>
              <ExternalLink />
              Open Link
            </ContextMenuItem>
          </>
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
}

function GridImagePreview({
  fileId,
  thumbnailId,
  altText,
  width,
  height,
}: {
  fileId: Id<"_storage"> | undefined;
  thumbnailId?: Id<"_storage"> | undefined;
  altText?: string;
  width?: number;
  height?: number;
}) {
  // Prefer thumbnail over full image for grid display
  const preferredFileId = thumbnailId || fileId;
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    preferredFileId ? { fileId: preferredFileId } : "skip"
  );

  if (!fileUrl) return null;

  // Calculate aspect ratio if dimensions are available
  const aspectRatio = width && height ? width / height : undefined;

  // Use a container div to maintain aspect ratio for better masonry layout
  if (aspectRatio && width && height) {
    // Calculate the actual height based on the container's potential width
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: aspectRatio.toString(),
          minHeight: "100px", // Prevent collapse during loading
        }}
        className="bg-card rounded-xl border overflow-hidden"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fileUrl}
          alt={altText}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback for images without dimension metadata
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fileUrl}
      alt={altText}
      className="w-full object-cover bg-card rounded-xl border"
    />
  );
}

function GridDocumentPreview({
  thumbnailId,
  fileName,
}: {
  thumbnailId?: Id<"_storage"> | undefined;
  fileName?: string;
}) {
  // Only fetch thumbnail URL if we have a thumbnailId
  const thumbnailUrl = useQuery(
    api.cards.getFileUrl,
    thumbnailId ? { fileId: thumbnailId } : "skip"
  );

  // If we have a thumbnail, show the thumbnail image with filename overlay
  if (thumbnailId && thumbnailUrl) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl}
          alt={`Preview of ${fileName || "document"}`}
          className="w-full object-contain bg-muted"
          loading="lazy"
        />
        <div className="px-4 py-3 border-t flex gap-2 items-center">
          <File className="shrink-0 size-4 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{fileName}</span>
        </div>
      </div>
    );
  }

  // Fallback: show icon-based display (for non-PDF documents or if thumbnail not ready)
  return (
    <div className="p-4 flex gap-2 items-center bg-card rounded-xl border">
      <File className="shrink-0 size-4 text-muted-foreground" />
      <span className="truncate font-medium">{fileName}</span>
    </div>
  );
}

function GridVideoPreview({
  fileId,
  thumbnailId,
}: {
  fileId: Id<"_storage"> | undefined;
  thumbnailId?: Id<"_storage"> | undefined;
}) {
  // Prefer thumbnail over video file for grid display
  const thumbnailUrl = useQuery(
    api.cards.getFileUrl,
    thumbnailId ? { fileId: thumbnailId } : "skip"
  );

  // If we have a thumbnail, show it with a play icon overlay
  if (thumbnailId && thumbnailUrl) {
    return (
      <div className="relative rounded-xl border bg-card overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl}
          alt="Video thumbnail"
          className="w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-black/50 p-2">
            <PlayCircle className="size-8 text-white" />
          </div>
        </div>
      </div>
    );
  }

  // Fallback: show icon-based display (if thumbnail not ready)
  return (
    <div className="w-full h-32 flex items-center justify-center bg-black text-white rounded-xl border">
      <PlayCircle className="size-8" />
    </div>
  );
}
