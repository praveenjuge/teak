import {
  ExternalLink,
  File,
  Heart,
  RotateCcw,
  Trash,
  Trash2,
  Video,
} from "lucide-react";
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
import { type Doc } from "@teak/convex/_generated/dataModel";

interface CardProps {
  card: Doc<"cards">;
  onClick?: (card: Doc<"cards">) => void;
  onDelete?: (cardId: string) => void;
  onRestore?: (cardId: string) => void;
  onPermanentDelete?: (cardId: string) => void;
  onToggleFavorite?: (cardId: string) => void;
  isTrashMode?: boolean;
}

// Simple seeded random function for consistent wave patterns
function seededRandom(seed: string, index: number): number {
  const hash = seed.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, index);
  return Math.abs(Math.sin(hash)) * 0.6 + 0.2; // Returns value between 0.2 and 0.8
}

export function Card({
  card,
  onClick,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggleFavorite,
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <UICard
          className={`cursor-pointer bg-transparent rounded-none border-0 relative p-0 overflow-hidden ${
            card.isDeleted ? "opacity-60" : ""
          }`}
          onClick={handleClick}
        >
          {card.isFavorited && (
            <div className="absolute top-3 right-3 z-10">
              <Heart className="size-4 fill-destructive text-destructive" />
            </div>
          )}

          <CardContent className="p-0 space-y-2">
            {card.type === "text" && (
              <div className="p-4 bg-background rounded-xl border">
                <p className="line-clamp-3 font-medium">{card.content}</p>
              </div>
            )}

            {card.type === "quote" && (
              <div className="py-4 px-6 bg-background rounded-xl border">
                <div className="relative">
                  <p className="line-clamp-3 font-medium italic text-muted-foreground leading-relaxed text-center text-balance">
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
              <div>
                {card.metadata?.microlinkData?.data?.image?.url ? (
                  <>
                    <img
                      src={card.metadata.microlinkData.data.image.url}
                      alt=""
                      className="w-full h-28 object-cover bg-background rounded-xl border"
                    />
                    <div className="p-2 pb-0">
                      <h4 className="font-medium truncate text-balance text-center line-clamp-1 text-muted-foreground">
                        {card.metadata?.microlinkData?.data?.title || card.url}
                      </h4>
                    </div>
                  </>
                ) : (
                  <div className="p-4 bg-background rounded-xl border">
                    <h4 className="font-medium truncate text-balance text-center line-clamp-1 text-muted-foreground">
                      {card.metadata?.microlinkData?.data?.title || card.url}
                    </h4>
                  </div>
                )}
              </div>
            )}

            {card.type === "image" && (
              <GridImagePreview
                fileId={card.fileId}
                altText={card.content}
                width={card.fileMetadata?.width}
                height={card.fileMetadata?.height}
              />
            )}

            {card.type === "video" && (
              <div className="w-full h-32 flex items-center justify-center bg-background text-muted-foreground rounded-xl border">
                <Video />
              </div>
            )}

            {card.type === "audio" && (
              <div className="flex h-14 items-center justify-between space-x-0.5 px-4 py-2 bg-background rounded-xl border">
                {Array.from({ length: 45 }).map((_, i) => (
                  <div
                    className="rounded-full bg-muted-foreground"
                    key={i}
                    style={{
                      width: "2px",
                      height: `${seededRandom(card._id, i) * 60 + 20}%`,
                    }}
                  />
                ))}
              </div>
            )}

            {card.type === "document" && (
              <div className="p-4 flex gap-2 items-center bg-background rounded-xl border">
                <File className="shrink-0 size-4 text-muted-foreground" />
                <span className="truncate font-medium">
                  {card.fileMetadata?.fileName || card.content}
                </span>
              </div>
            )}

            {card.type === "palette" && (
              <div className="flex bg-background rounded-xl border overflow-hidden">
                {card.colors?.slice(0, 12).map((color, index) => (
                  <div
                    key={`${color.hex}-${index}`}
                    className="h-14 flex-1 min-w-0"
                    style={{ backgroundColor: color.hex }}
                    title={color.hex}
                  />
                ))}
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
  altText,
  width,
  height,
}: {
  fileId: Id<"_storage"> | undefined;
  altText?: string;
  width?: number;
  height?: number;
}) {
  const fileUrl = useQuery(api.cards.getFileUrl, fileId ? { fileId } : "skip");
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
        className="bg-background rounded-xl border"
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
      className="w-full object-cover bg-background rounded-xl border"
    />
  );
}
