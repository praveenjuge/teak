import {
  CheckSquare,
  ExternalLink,
  File,
  Heart,
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
  const handleClick = () => {
    onClick?.(card);
  };

  const handleDelete = () => {
    onDelete?.(card._id);
  };

  const handleRestore = () => {
    onRestore?.(card._id);
  };

  const handlePermanentDelete = () => {
    onPermanentDelete?.(card._id);
  };

  const handleToggleFavorite = () => {
    onToggleFavorite?.(card._id);
  };

  const openLink = () => {
    if (card.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleSelect = () => {
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
      <ContextMenuTrigger asChild>
        <UICard
          className={`cursor-pointer bg-transparent rounded-none border-0 relative p-0 overflow-hidden ${
            card.isDeleted ? "opacity-60" : ""
          } ${isSelected ? "ring-2 ring-primary rounded-xl" : ""}`}
          onClick={handleClick}
        >
          {isSelectionMode && (
            <div className="absolute top-3 left-3 z-10">
              <Checkbox
                checked={isSelected}
                className="select-auto pointer-events-none"
              />
            </div>
          )}
          {card.isFavorited && (
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
              <div className="w-full h-32 flex items-center justify-center bg-muted text-muted-foreground rounded-xl border">
                <PlayCircle />
              </div>
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
              <div className="p-4 flex gap-2 items-center bg-card rounded-xl border">
                <File className="shrink-0 size-4 text-muted-foreground" />
                <span className="truncate font-medium">
                  {card.fileMetadata?.fileName || card.content}
                </span>
              </div>
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
