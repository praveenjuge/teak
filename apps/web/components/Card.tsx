import { ExternalLink, Heart, RotateCcw, Trash, Trash2 } from "lucide-react";
import { useQuery } from "convex/react";
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
          className={`cursor-pointer relative p-0 shadow-none overflow-hidden ${
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
              <p className="whitespace-pre-wrap p-4 line-clamp-3">
                {card.content}
              </p>
            )}

            {card.type === "link" && (
              <div>
                {card.metadata?.linkImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.metadata.linkImage}
                    alt=""
                    className="w-full h-28 object-cover"
                  />
                )}
                <div className="p-4">
                  <h4 className="font-medium line-clamp-1">
                    {card.metadata?.linkTitle || "Link"}
                  </h4>
                  {card.url && (
                    <p className="text-muted-foreground truncate">{card.url}</p>
                  )}
                </div>
              </div>
            )}

            {card.type === "image" && (
              <GridImagePreview
                fileId={card.fileId}
                altText={card.content}
                width={card.metadata?.width}
                height={card.metadata?.height}
              />
            )}

            {card.type === "video" && (
              <div className="w-full h-32 bg-black flex items-center justify-center text-white/60">
                Video
              </div>
            )}

            {card.type === "audio" && (
              <div className="flex h-16 items-center justify-between space-x-0.5 p-4">
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
              <div className="p-4">
                {card.metadata?.fileName || card.content}
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
            <ContextMenuItem
              onClick={handleDelete}
              className="text-destructive focus:text-destructive"
            >
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
            <ContextMenuItem
              onClick={handlePermanentDelete}
              className="text-destructive focus:text-destructive"
            >
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
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fileUrl}
          alt={altText}
          className="w-full h-full object-cover"
          style={{
            aspectRatio: aspectRatio.toString(),
            display: "block", // Prevent inline spacing issues
          }}
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback for images without dimension metadata
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={fileUrl} alt={altText} className="w-full object-cover" />
  );
}
