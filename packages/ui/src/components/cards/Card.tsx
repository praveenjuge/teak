import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { CardContent, Card as UICard } from "@teak/ui/components/ui/card";
import { Checkbox } from "@teak/ui/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@teak/ui/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import { useAction } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  Folder as FolderIcon,
  Heart,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Tag,
  Trash,
  Trash2,
} from "lucide-react";
import type {
  ComponentProps,
  ComponentType,
  DragEvent,
  KeyboardEvent,
  ReactNode,
  SyntheticEvent,
} from "react";
import { memo, useRef, useState } from "react";
import { toast } from "sonner";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import { rememberCardOpenOrigin } from "../../lib/cardOpenOrigin";
import { CARD_DRAG_TYPE } from "../../lib/folders";
import { resolveLinkTitle } from "../../lib/linkTitle";
import { markdownToPlainText } from "../../lib/markdownToPlainText";
import { prefetchCardModalMedia } from "../../lib/prefetchCardMedia";
import { cn } from "../../lib/utils";
import { prefetchFileTextPreview } from "../card-previews/fileTextPreviewCache";
import {
  CARD_SURFACE,
  formatDuration,
  getDisplayHostname,
  getFileFormatBadge,
  isCardProcessing,
  readableTextOn,
  splitNotePreview,
} from "./cardDisplay";
import { AudioWavePreview } from "./previews/AudioWavePreview";
import { GridDocumentPreview } from "./previews/GridDocumentPreview";
import { GridImagePreview } from "./previews/GridImagePreview";
import { GridVideoPreview } from "./previews/GridVideoPreview";
import { ResilientMediaImage } from "./previews/ResilientMediaImage";
import { SiteFavicon } from "./SiteFavicon";
import type { CardProps, CardWithUrls, LinkPreviewMetadata } from "./types";
import { isOptimisticCard } from "./types";

export type { CardProps, CardWithUrls, LinkPreviewMetadata } from "./types";

export async function resolveImageCopyUrl({
  cardId,
  fallbackUrl,
  fileKey,
  refresh,
}: {
  cardId: string;
  fallbackUrl: string;
  fileKey?: string;
  refresh: (args: {
    cardId: Id<"cards">;
    key: string;
  }) => Promise<{ url: string }>;
}): Promise<string> {
  if (!fileKey) {
    return fallbackUrl;
  }
  const { url } = await refresh({
    cardId: cardId as Id<"cards">,
    key: fileKey,
  });
  return url;
}

const MAX_ACCESSIBLE_LABEL_LENGTH = 120;

/**
 * Name for a card in the grid, read by screen readers: its type plus the
 * title, text or file name the grid shows.
 */
export function getCardAccessibleLabel(
  card: Pick<
    CardWithUrls,
    "content" | "fileMetadata" | "metadataTitle" | "type" | "url"
  >,
  linkTitle?: string
): string {
  const typeLabel =
    (card.type && CARD_TYPE_LABELS[card.type as CardType]) || "Card";
  const isFileCard =
    card.type === "image" ||
    card.type === "video" ||
    card.type === "audio" ||
    card.type === "document";
  const title =
    (card.type === "link" ? linkTitle || card.metadataTitle || card.url : "") ||
    (isFileCard ? card.fileMetadata?.fileName : "") ||
    markdownToPlainText(card.content) ||
    card.metadataTitle ||
    card.fileMetadata?.fileName ||
    "";
  if (!title) {
    return `${typeLabel} card`;
  }
  const clipped =
    title.length > MAX_ACCESSIBLE_LABEL_LENGTH
      ? `${title.slice(0, MAX_ACCESSIBLE_LABEL_LENGTH - 1)}…`
      : title;
  return `${typeLabel}: ${clipped}`;
}

export const Card = memo(function Card({
  card,
  onClick,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggleFavorite,
  onToggleArchive,
  onAddTags,
  onEditFolders,
  onCopyImage,
  isSelectionMode,
  isSelected,
  isPriority = false,
  isTabStop = true,
  onEnterSelectionMode,
  onToggleSelection,
}: CardProps) {
  const refreshCardMediaUrl = useAction(
    api.card.getFileUrl.refreshCardMediaUrl
  );
  const { pendingCardId: reprocessingCardId, reprocess } = useReprocessCard();
  const isOptimistic = isOptimisticCard(card._id);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileName = card.fileMetadata?.fileName;
  const fileFormat =
    card.type === "document" && fileName
      ? inferFileFormat({ fileName, mimeType: card.fileMetadata?.mimeType })
      : null;

  const prefetchDocumentPreview = () => {
    if (
      isOptimistic ||
      !card.fileKey ||
      !card.fileUrl ||
      !fileFormat ||
      !["markdown", "source"].includes(fileFormat.preview)
    ) {
      return;
    }

    void prefetchFileTextPreview({
      cacheKey: card.fileKey,
      fileUrl: card.fileUrl,
    }).catch(() => {
      // The modal retries and keeps file facts visible if intent prefetch fails.
    });
  };

  const handlePrefetch = () => {
    if (isOptimistic) {
      return;
    }
    prefetchDocumentPreview();
    prefetchCardModalMedia(card);
  };

  const handleClick = () => {
    if (isOptimistic) {
      return;
    }
    if (cardRef.current && !isSelectionMode) {
      rememberCardOpenOrigin(card._id, cardRef.current.getBoundingClientRect());
    }
    onClick?.(card);
  };

  // Cards act as buttons: Enter or Space opens them (or toggles selection).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
    }
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

  const handleToggleArchive = () => {
    if (isOptimistic) {
      return;
    }
    onToggleArchive?.(card._id, !card.isArchived);
  };

  const handleReprocess = () => {
    if (isOptimistic) {
      return;
    }
    void reprocess(card._id);
  };

  const handleAddTags = () => {
    if (isOptimistic) {
      return;
    }
    onAddTags?.(card._id);
  };

  const handleCopyImage = async () => {
    if (isOptimistic) {
      return;
    }
    let contentToCopy = "";
    let isImage = false;
    if (card.type === "image") {
      isImage = true;
      const fallbackUrl = card.fileUrl ?? card.thumbnailUrl ?? "";
      try {
        contentToCopy = await resolveImageCopyUrl({
          cardId: card._id,
          fallbackUrl,
          fileKey: card.fileKey,
          refresh: refreshCardMediaUrl,
        });
      } catch {
        toast.error("Failed to copy image");
        return;
      }
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
    const safeUrl = sanitizeExternalUrl(card.url);
    if (safeUrl) {
      window.open(safeUrl, "_blank", "noopener,noreferrer");
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
  const storedLinkMedia = Array.isArray(card.metadata?.linkPreview?.media)
    ? (card.metadata.linkPreview.media as Record<string, unknown>[])
    : [];
  const linkCardTitle = resolveLinkTitle({
    metadataTitle: card.metadataTitle,
    metadataTitleEdited: card.metadataTitleEdited,
    previewTitle: linkPreview?.title,
    url: card.url,
  });
  const primaryAttachedMedia =
    card.linkPreviewMedia?.find((item) => item.type === "image") ??
    card.linkPreviewMedia?.find(
      (item) => item.type === "video" && typeof item.posterUrl === "string"
    );
  const linkCardImage =
    primaryAttachedMedia?.type === "image"
      ? primaryAttachedMedia.url
      : (primaryAttachedMedia?.posterUrl ?? card.linkPreviewImageUrl);
  const primaryStoredMedia =
    storedLinkMedia.find((item) => item.type === "image") ??
    storedLinkMedia.find(
      (item) =>
        item.type === "video" && typeof item.posterStorageKey === "string"
    );
  const primaryLinkImageKey =
    primaryStoredMedia?.type === "image"
      ? primaryStoredMedia.storageKey
      : (primaryStoredMedia?.posterStorageKey ??
        card.metadata?.linkPreview?.imageStorageKey);
  const screenshotStorageKey = card.metadata?.linkPreview?.screenshotStorageKey;
  const resolvedScreenshotUrl =
    typeof card.screenshotUrl === "string" ? card.screenshotUrl : undefined;
  const [useFallbackImage, setUseFallbackImage] = useState(false);

  const attachedImageSize =
    primaryAttachedMedia?.type === "image" &&
    typeof primaryAttachedMedia.width === "number" &&
    typeof primaryAttachedMedia.height === "number"
      ? {
          width: primaryAttachedMedia.width,
          height: primaryAttachedMedia.height,
        }
      : undefined;
  const attachedPosterSize =
    primaryAttachedMedia?.type === "video" &&
    typeof primaryAttachedMedia.posterWidth === "number" &&
    typeof primaryAttachedMedia.posterHeight === "number"
      ? {
          width: primaryAttachedMedia.posterWidth,
          height: primaryAttachedMedia.posterHeight,
        }
      : undefined;
  const linkPreviewImageSize =
    typeof linkPreview?.imageWidth === "number" &&
    typeof linkPreview?.imageHeight === "number"
      ? { width: linkPreview.imageWidth, height: linkPreview.imageHeight }
      : undefined;
  const primaryImageSize =
    attachedImageSize ?? attachedPosterSize ?? linkPreviewImageSize;
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

  const fallbackDisplayUrl = hasFallbackImage
    ? resolvedScreenshotUrl
    : undefined;
  const primaryDisplayUrl = hasPrimaryImage ? linkCardImage : undefined;
  const fallbackDisplaySize = hasFallbackImage ? fallbackImageSize : undefined;
  const primaryDisplaySize = hasPrimaryImage ? primaryImageSize : undefined;
  const displayLinkImage = shouldUseFallback
    ? fallbackDisplayUrl
    : primaryDisplayUrl;
  const displayLinkImageSize = shouldUseFallback
    ? fallbackDisplaySize
    : primaryDisplaySize;
  const displayLinkImageKey = shouldUseFallback
    ? screenshotStorageKey
    : primaryLinkImageKey;

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

  const hostname =
    card.type === "link" ? getDisplayHostname(card.url) : undefined;
  const linkDescription =
    linkPreview?.description || card.metadataDescription || card.aiSummary;
  const isProcessing =
    !(isOptimistic || card.isDeleted) && isCardProcessing(card);
  const showFavoriteMark = Boolean(card.isFavorited && !isOptimistic);
  // Text-only cards keep their first line clear of the favorite mark. The
  // selection checkbox sits on the card's corner instead, so selecting never
  // rewraps text or moves the grid.
  const textInsets = showFavoriteMark ? "pr-11" : "";

  // A link is named by its favicon and title; the site's name would only
  // repeat what the favicon already says.
  const linkTitleRow = (
    <div className="flex min-w-0 items-center gap-2">
      {hostname && <SiteFavicon className="size-4" hostname={hostname} />}
      <p className="min-w-0 truncate font-medium leading-snug" dir="auto">
        {linkCardTitle}
      </p>
    </div>
  );

  const linkFooter = <div className="px-4 py-3">{linkTitleRow}</div>;

  const renderCardContent = () => {
    if (card.type === "text") {
      const { heading, body } = splitNotePreview(card.content);
      const headingText = markdownToPlainText(heading);
      const bodyText = markdownToPlainText(body) || card.fileMetadata?.fileName;
      return (
        <div className={cn(CARD_SURFACE, "space-y-1.5 p-4", textInsets)}>
          {headingText ? (
            <>
              <p
                className="line-clamp-2 break-words font-semibold leading-snug"
                dir="auto"
              >
                {headingText}
              </p>
              <p
                className="line-clamp-5 break-words text-muted-foreground text-sm leading-relaxed"
                dir="auto"
              >
                {bodyText}
              </p>
            </>
          ) : (
            <p
              className="line-clamp-6 break-words font-medium leading-relaxed"
              dir="auto"
            >
              {bodyText}
            </p>
          )}
        </div>
      );
    }

    if (card.type === "quote") {
      return (
        <figure
          className={cn(CARD_SURFACE, "relative px-5 pt-8 pb-5", textInsets)}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-4 select-none font-serif text-4xl text-muted-foreground/35 leading-none"
          >
            &ldquo;
          </span>
          <blockquote
            className="line-clamp-6 text-pretty break-words font-medium italic leading-relaxed"
            dir="auto"
          >
            {markdownToPlainText(card.content)}
          </blockquote>
        </figure>
      );
    }

    if (card.type === "link") {
      if (displayLinkImage && displayLinkImageSize) {
        return (
          <div className={cn(CARD_SURFACE, "overflow-hidden")}>
            <div
              className="w-full overflow-hidden border-b bg-muted"
              style={{
                aspectRatio: Math.min(
                  Math.max(
                    displayLinkImageSize.width / displayLinkImageSize.height,
                    0.5
                  ),
                  3
                ),
              }}
            >
              <ResilientMediaImage
                alt={linkCardTitle}
                cardId={card._id}
                className="h-full w-full object-cover object-top"
                onPermanentError={handleLinkImageError}
                src={displayLinkImage}
                storageKey={
                  typeof displayLinkImageKey === "string"
                    ? displayLinkImageKey
                    : undefined
                }
              />
            </div>
            {linkFooter}
          </div>
        );
      }

      if (legacyDisplayImage) {
        const legacyKey = useFallbackImage
          ? screenshotStorageKey
          : primaryLinkImageKey;
        return (
          <div className={cn(CARD_SURFACE, "overflow-hidden")}>
            <div className="h-32 min-h-32 overflow-hidden border-b bg-muted">
              <ResilientMediaImage
                alt={linkCardTitle}
                cardId={card._id}
                className="h-full w-full object-cover object-top"
                onPermanentError={handleLinkImageError}
                src={legacyDisplayImage}
                storageKey={
                  typeof legacyKey === "string" ? legacyKey : undefined
                }
              />
            </div>
            {linkFooter}
          </div>
        );
      }

      const titleIsUrl = linkCardTitle === card.url;
      return (
        <div className={cn(CARD_SURFACE, "space-y-1.5 p-4", textInsets)}>
          <div className="flex min-w-0 items-center gap-2">
            {hostname && <SiteFavicon className="size-4" hostname={hostname} />}
            <p className="min-w-0 truncate font-medium leading-snug" dir="auto">
              {titleIsUrl
                ? linkCardTitle.replace(/^https?:\/\/(www\.)?/, "")
                : linkCardTitle}
            </p>
          </div>
          {linkDescription && !titleIsUrl && (
            <p
              className="line-clamp-2 break-words text-muted-foreground text-sm leading-relaxed"
              dir="auto"
            >
              {linkDescription}
            </p>
          )}
        </div>
      );
    }

    if (card.type === "image") {
      return (
        <GridImagePreview
          altText={card.content}
          cardId={card._id}
          compactUrl={card.compactUrl}
          height={card.fileMetadata?.height}
          imageUrl={
            card.thumbnailUrl ?? card.compactUrl ?? card.fileUrl ?? undefined
          }
          isPriority={isPriority}
          placeholderColor={card.colors?.[0]?.hex}
          storageKey={card.fileKey}
          width={card.fileMetadata?.width}
        />
      );
    }

    if (card.type === "video") {
      const isGif =
        card.fileMetadata?.mimeType === "image/gif" ||
        (card.fileMetadata?.fileName?.toLowerCase().endsWith(".gif") ?? false);
      return (
        <GridVideoPreview
          cardId={card._id}
          height={card.fileMetadata?.height}
          isGif={isGif}
          isPriority={isPriority}
          scrub={card.fileMetadata?.scrub}
          scrubKey={card.scrubKey}
          scrubUrl={card.scrubUrl}
          thumbnailKey={card.thumbnailKey}
          thumbnailUrl={card.thumbnailUrl ?? undefined}
          videoKey={card.fileKey}
          videoUrl={card.fileUrl ?? undefined}
          width={card.fileMetadata?.width}
        />
      );
    }

    if (card.type === "audio") {
      return (
        <AudioWavePreview
          cardId={card._id}
          durationLabel={formatDuration(card.fileMetadata?.duration)}
          title={card.metadataTitle || fileName || "Recording"}
          waveformGrid={card.fileMetadata?.waveform?.grid}
        />
      );
    }

    if (card.type === "document") {
      return (
        <GridDocumentPreview
          cardId={card._id}
          fileName={card.fileMetadata?.fileName || card.content}
          formatBadge={getFileFormatBadge(
            fileName,
            card.fileMetadata?.mimeType
          )}
          height={card.fileMetadata?.height}
          isPriority={isPriority}
          thumbnailKey={card.thumbnailKey}
          thumbnailUrl={card.thumbnailUrl ?? undefined}
          width={card.fileMetadata?.width}
        />
      );
    }

    if (card.type === "palette" && card.colors?.length) {
      return (
        <div className={cn(CARD_SURFACE, "flex h-20 overflow-hidden")}>
          {card.colors.slice(0, 12).map((color, index) => (
            <div
              className="group/swatch flex min-w-0 flex-1 items-end justify-center overflow-hidden pb-2 transition-[flex-grow] duration-300 ease-out hover:flex-[2.6] motion-reduce:transition-none"
              // biome-ignore lint/suspicious/noArrayIndexKey: a palette may repeat a color
              key={`${color.hex}-${index}`}
              style={{
                backgroundColor: color.hex,
                color: readableTextOn(color.hex),
              }}
              title={color.hex}
            >
              <span className="whitespace-nowrap font-medium font-mono text-[10px] uppercase opacity-0 transition-opacity duration-200 group-hover/swatch:opacity-80">
                {color.hex}
              </span>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className={cn(CARD_SURFACE, "p-4", textInsets)}>
        <p className="line-clamp-4 break-words font-medium" dir="auto">
          {markdownToPlainText(card.content) || card.fileMetadata?.fileName}
        </p>
      </div>
    );
  };

  // A card can be dragged onto a sidebar folder to add it there. Its own
  // drag data replaces the image or link the browser would otherwise carry.
  const canDrag = !(isOptimistic || isSelectionMode || card.isDeleted);
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.clearData();
    event.dataTransfer.setData(CARD_DRAG_TYPE, card._id);
    event.dataTransfer.effectAllowed = "copy";
  };

  const canCopy =
    !card.isDeleted &&
    (card.type === "text" ||
      card.type === "link" ||
      (card.type === "image" &&
        card.fileMetadata?.mimeType !== "image/svg+xml"));
  const copyLinkOrImageLabel =
    card.type === "link" ? "Copy Link" : "Copy Image";
  const copyMenuLabel =
    card.type === "text" ? "Copy Text" : copyLinkOrImageLabel;

  const menuItems: CardMenuEntry[] = [
    ...(card.url
      ? [{ icon: ExternalLink, label: "Open Link", onSelect: openLink }]
      : []),
    ...(canCopy
      ? [
          {
            icon: Copy,
            label: copyMenuLabel,
            onSelect: () => void handleCopyImage(),
          },
        ]
      : []),
    ...(card.isDeleted
      ? [
          { icon: RotateCcw, label: "Restore", onSelect: handleRestore },
          "separator" as const,
          {
            destructive: true,
            icon: Trash,
            label: "Delete Forever",
            onSelect: handlePermanentDelete,
          },
        ]
      : [
          isSelectionMode
            ? {
                icon: CheckSquare,
                label: isSelected ? "Deselect" : "Select",
                onSelect: () => onToggleSelection?.(),
              }
            : { icon: CheckSquare, label: "Select", onSelect: handleSelect },
          { icon: Tag, label: "Add Tags", onSelect: handleAddTags },
          ...(onEditFolders
            ? [
                {
                  icon: FolderIcon,
                  label: "Folders…",
                  onSelect: () => {
                    if (!isOptimistic) {
                      onEditFolders(card._id);
                    }
                  },
                },
              ]
            : []),
          {
            icon: Heart,
            iconClassName: card.isFavorited
              ? "fill-destructive text-destructive"
              : undefined,
            label: card.isFavorited ? "Unfavorite" : "Favorite",
            onSelect: handleToggleFavorite,
          },
          {
            disabled: reprocessingCardId === card._id,
            icon: RefreshCw,
            label: "Refresh details",
            onSelect: handleReprocess,
          },
          ...(onToggleArchive
            ? [
                {
                  icon: card.isArchived ? ArchiveRestore : Archive,
                  label: card.isArchived ? "Unarchive" : "Archive",
                  onSelect: handleToggleArchive,
                },
              ]
            : []),
          "separator" as const,
          { icon: Trash2, label: "Delete", onSelect: handleDelete },
        ]),
  ];

  const showQuickActions = !(isOptimistic || isSelectionMode);
  const showHoverSelect =
    !(isOptimistic || isSelectionMode || card.isDeleted) &&
    Boolean(onEnterSelectionMode);
  const isMediaCard =
    card.type === "image" ||
    card.type === "video" ||
    card.type === "document" ||
    (card.type === "link" && Boolean(displayLinkImage || legacyDisplayImage)) ||
    (card.type === "palette" && Boolean(card.colors?.length));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={isOptimistic}>
        <div className="group/card relative" data-card-shell="">
          <UICard
            aria-disabled={isOptimistic || undefined}
            aria-label={getCardAccessibleLabel(card, linkCardTitle)}
            aria-pressed={isSelectionMode ? Boolean(isSelected) : undefined}
            className={cn(
              "relative scroll-my-20 overflow-hidden rounded-2xl border-0 bg-transparent p-0 outline-none contain-content focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isOptimistic ? "cursor-default opacity-70" : "cursor-pointer",
              card.isDeleted && "opacity-60",
              isSelected &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
            data-card-id={isOptimistic ? undefined : card._id}
            draggable={canDrag}
            onClick={handleClick}
            onDragStart={canDrag ? handleDragStart : undefined}
            onFocus={handlePrefetch}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePrefetch}
            onPointerEnter={handlePrefetch}
            ref={cardRef}
            role="button"
            tabIndex={isOptimistic || !isTabStop ? -1 : 0}
          >
            {isOptimistic && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            <CardContent className="p-0">{renderCardContent()}</CardContent>
            {isProcessing && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full"
              >
                <div className="h-full w-1/3 animate-progress-slide rounded-full bg-foreground/30 motion-reduce:animate-none" />
              </div>
            )}
          </UICard>

          {isSelectionMode && !isOptimistic && (
            <div className="pointer-events-none absolute -top-2 -left-2 z-10">
              {/* Decorative: the card itself is the toggle (aria-pressed),
                  so the box stays out of the Tab order. */}
              <Checkbox
                aria-hidden="true"
                checked={isSelected}
                className="size-6 rounded-full border-foreground/25 bg-background shadow-sm ring-2 ring-background"
                tabIndex={-1}
              />
            </div>
          )}

          {showHoverSelect && (
            <button
              aria-label="Select"
              className="absolute -top-2 -left-2 z-20 flex size-6 items-center justify-center rounded-full border border-foreground/25 bg-background text-muted-foreground opacity-0 shadow-sm ring-2 ring-background transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
              onClick={handleSelect}
              tabIndex={-1}
              title="Select"
              type="button"
            >
              <Check className="size-3.5" strokeWidth={2.5} />
            </button>
          )}

          {showFavoriteMark && (
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-2.5 right-2.5 z-10 flex size-7 items-center justify-center rounded-full transition-opacity duration-150",
                isMediaCard &&
                  "bg-background/85 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10",
                showQuickActions && "group-hover/card:opacity-0"
              )}
            >
              <Heart className="size-3.5 fill-destructive text-destructive" />
            </div>
          )}

          {showQuickActions && (
            <div className="pointer-events-none absolute top-2.5 right-2.5 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/card:pointer-events-auto group-hover/card:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100">
              {card.url && !card.isDeleted && (
                <QuickActionButton label="Open link" onClick={openLink}>
                  <ArrowUpRight />
                </QuickActionButton>
              )}
              {!card.isDeleted && (
                <QuickActionButton
                  label={card.isFavorited ? "Unfavorite" : "Favorite"}
                  onClick={handleToggleFavorite}
                  pressed={Boolean(card.isFavorited)}
                >
                  <Heart
                    className={cn(
                      card.isFavorited && "fill-destructive text-destructive"
                    )}
                  />
                </QuickActionButton>
              )}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <QuickActionButton label="More actions">
                    <MoreHorizontal />
                  </QuickActionButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <CardMenuEntries
                    entries={menuItems}
                    Item={DropdownMenuItem}
                    Separator={DropdownMenuSeparator}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <CardMenuEntries
          entries={menuItems}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

type CardMenuEntry =
  | "separator"
  | {
      destructive?: boolean;
      disabled?: boolean;
      icon: ComponentType<{ className?: string }>;
      iconClassName?: string;
      label: string;
      onSelect: () => void;
    };

type MenuItemComponent = ComponentType<{
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "default" | "destructive";
}>;

/** The card's actions, as its context menu and its More menu both list them. */
function CardMenuEntries({
  entries,
  Item,
  Separator,
}: {
  entries: CardMenuEntry[];
  Item: MenuItemComponent;
  Separator: ComponentType;
}) {
  return entries.map((entry, index) => {
    if (entry === "separator") {
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
      return <Separator key={`separator-${index}`} />;
    }
    const Icon = entry.icon;
    return (
      <Item
        disabled={entry.disabled}
        key={entry.label}
        onClick={entry.onSelect}
        variant={entry.destructive ? "destructive" : "default"}
      >
        <Icon className={entry.iconClassName} />
        {entry.label}
      </Item>
    );
  });
}

function QuickActionButton({
  children,
  label,
  pressed,
  ref,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  pressed?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className="flex size-7 items-center justify-center rounded-full bg-background/85 text-foreground/80 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition-colors hover:bg-background hover:text-foreground data-[state=open]:bg-background dark:ring-white/10 [&_svg]:size-3.5"
      ref={ref}
      tabIndex={-1}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
