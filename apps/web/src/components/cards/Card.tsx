import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { cardLinkTokensToText } from "@teak/convex/shared/cardLinks";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useAction } from "convex/react";
import type { DragEvent, KeyboardEvent } from "react";
import { memo, useRef } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  Folder as FolderIcon,
  Heart,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  SquareCheckBig,
  Tag,
  Trash,
} from "vadivam-react";
import { CardContent, Card as UICard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openCardLink } from "@/lib/openCardLink";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import { rememberCardOpenOrigin } from "../../lib/cardOpenOrigin";
import { CARD_DRAG_TYPE } from "../../lib/folders";
import { focusedCardShortcuts } from "../../lib/gridKeys";
import { resolveLinkTitle } from "../../lib/linkTitle";
import { markdownToPlainText } from "../../lib/markdownToPlainText";
import { prefetchCardModalMedia } from "../../lib/prefetchCardMedia";
import { cn } from "../../lib/utils";
import { preloadCardModal } from "../card-modal/LazyCardModal";
import { prefetchFileTextPreview } from "../card-previews/fileTextPreviewCache";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import { CardBody } from "./CardBody";
import {
  CardMenuEntries,
  type CardMenuEntry,
  handleCardMenuShortcut,
  QuickActionButton,
} from "./CardMenu";
import { isCardProcessing } from "./cardDisplay";
import { successfulLinkPreview, useLinkCardImage } from "./linkCardImage";
import type { CardProps, CardWithUrls } from "./types";
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

/**
 * What Copy copies from a note or a link: a note's Markdown with its
 * `[[Title|teak:<id>]]` links as their titles, or a link's URL.
 */
export function cardCopyText(
  card: Pick<CardWithUrls, "content" | "type" | "url">
): string {
  if (card.type === "text") {
    return cardLinkTokensToText(card.content ?? "");
  }
  return card.type === "link" ? (card.url ?? "") : "";
}

const MAX_ACCESSIBLE_LABEL_LENGTH = 120;

type AccessibleLabelTranslator = TeakTranslator<"cards.accessibleLabel">;

const englishAccessibleLabel: AccessibleLabelTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "cards.accessibleLabel"
);

export function getCardAccessibleLabel(
  card: Pick<
    CardWithUrls,
    "content" | "fileMetadata" | "metadataTitle" | "type" | "url"
  >,
  linkTitle?: string,
  t: AccessibleLabelTranslator = englishAccessibleLabel
): string {
  const type = card.type || "card";
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
    return t("untitled", { type });
  }
  const clipped =
    title.length > MAX_ACCESSIBLE_LABEL_LENGTH
      ? `${title.slice(0, MAX_ACCESSIBLE_LABEL_LENGTH - 1)}…`
      : title;
  return t("titled", { title: clipped, type });
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
  onEditLink,
  onCopyImage,
  isSelectionMode,
  isSelected,
  isPriority = false,
  isTabStop = true,
  onEnterSelectionMode,
  onToggleSelection,
}: CardProps) {
  const t = useTranslations("cards");
  const tLabel = useTranslations("cards.accessibleLabel");
  const tLinkTitle = useTranslations("lib.linkTitle");
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
    }).catch(() => undefined);
  };

  const handlePrefetch = () => {
    if (isOptimistic) {
      return;
    }
    preloadCardModal().catch(() => undefined);
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

  const canCopy =
    !card.isDeleted &&
    (card.type === "text" ||
      card.type === "link" ||
      (card.type === "image" &&
        card.fileMetadata?.mimeType !== "image/svg+xml"));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
      return;
    }
    if (
      canCopy &&
      (event.metaKey || event.ctrlKey) &&
      !(event.altKey || event.shiftKey || event.repeat) &&
      event.key.toLowerCase() === "c" &&
      (window.getSelection()?.isCollapsed ?? true)
    ) {
      event.preventDefault();
      void handleCopyImage();
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
        toast.error(t("copyImageFailed"));
        return;
      }
    } else {
      contentToCopy = cardCopyText(card);
    }
    if (contentToCopy) {
      onCopyImage?.(contentToCopy, isImage);
    }
  };

  const openLink = () => {
    openCardLink(card);
  };

  const handleSelect = () => {
    if (isOptimistic) {
      return;
    }
    onEnterSelectionMode?.(card._id);
  };

  const linkCardTitle = resolveLinkTitle(
    {
      metadataTitle: card.metadataTitle,
      metadataTitleEdited: card.metadataTitleEdited,
      previewTitle: successfulLinkPreview(card)?.title,
      url: card.url,
    },
    tLinkTitle
  );
  const { image: linkImage, onImageError: handleLinkImageError } =
    useLinkCardImage(card);

  const isProcessing =
    !(isOptimistic || card.isDeleted) && isCardProcessing(card);
  const showFavoriteMark = Boolean(card.isFavorited && !isOptimistic);
  const textInsets = showFavoriteMark ? "pr-11" : "";

  const canDrag = !(isOptimistic || isSelectionMode || card.isDeleted);
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.clearData();
    event.dataTransfer.setData(CARD_DRAG_TYPE, card._id);
    event.dataTransfer.effectAllowed = "copy";
  };

  const copyLinkOrImageLabel =
    card.type === "link" ? t("menu.copyLink") : t("menu.copyImage");
  const copyMenuLabel =
    card.type === "text" ? t("menu.copyText") : copyLinkOrImageLabel;

  const shortcuts = focusedCardShortcuts(Boolean(isSelectionMode));
  const menuItems: CardMenuEntry[] = [
    ...(card.url && !card.isDeleted
      ? [
          {
            icon: ExternalLink,
            id: "openLink",
            label: t("menu.openLink"),
            onSelect: openLink,
          },
        ]
      : []),
    ...(canCopy
      ? [
          {
            icon: Copy,
            id: "copy",
            label: copyMenuLabel,
            onSelect: () => void handleCopyImage(),
            shortcut: shortcuts.copy,
          },
        ]
      : []),
    ...(card.isDeleted
      ? [
          {
            icon: RotateCcw,
            id: "restore",
            label: t("menu.restore"),
            onSelect: handleRestore,
          },
          { separator: "before-delete-forever" },
          {
            destructive: true,
            icon: Trash,
            id: "deleteForever",
            label: t("menu.deleteForever"),
            onSelect: handlePermanentDelete,
            shortcut: shortcuts.delete,
          },
        ]
      : [
          isSelectionMode
            ? {
                icon: SquareCheckBig,
                id: "select",
                label: isSelected ? t("menu.deselect") : t("menu.select"),
                onSelect: () => onToggleSelection?.(card._id),
                shortcut: shortcuts.select,
              }
            : {
                icon: SquareCheckBig,
                id: "select",
                label: t("menu.select"),
                onSelect: handleSelect,
                shortcut: shortcuts.select,
              },
          {
            icon: Tag,
            id: "addTags",
            label: t("menu.addTags"),
            onSelect: handleAddTags,
            shortcut: shortcuts.addTags,
          },
          ...(onEditFolders
            ? [
                {
                  icon: FolderIcon,
                  id: "folders",
                  label: t("menu.folders"),
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
            id: "favorite",
            label: card.isFavorited ? t("menu.unfavorite") : t("menu.favorite"),
            onSelect: handleToggleFavorite,
            shortcut: shortcuts.favorite,
          },
          ...(onEditLink && card.type === "link" && card.url
            ? [
                {
                  icon: Pencil,
                  id: "editLink",
                  label: t("menu.editLink"),
                  onSelect: () => {
                    if (!isOptimistic) {
                      onEditLink(card._id);
                    }
                  },
                },
              ]
            : []),
          {
            disabled: reprocessingCardId === card._id,
            icon: RefreshCw,
            id: "refreshDetails",
            label: t("menu.refreshDetails"),
            onSelect: handleReprocess,
          },
          ...(onToggleArchive
            ? [
                {
                  icon: card.isArchived ? ArchiveRestore : Archive,
                  id: "archive",
                  label: card.isArchived
                    ? t("menu.unarchive")
                    : t("menu.archive"),
                  onSelect: handleToggleArchive,
                  shortcut: shortcuts.archive,
                },
              ]
            : []),
          { separator: "before-delete" },
          {
            icon: Trash,
            id: "delete",
            label: t("menu.moveToTrash"),
            onSelect: handleDelete,
            shortcut: shortcuts.delete,
          },
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
    (card.type === "link" && Boolean(linkImage)) ||
    (card.type === "palette" && Boolean(card.colors?.length));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={isOptimistic}>
        <div className="group/card relative" data-card-shell="">
          <UICard
            aria-disabled={isOptimistic || undefined}
            aria-label={getCardAccessibleLabel(card, linkCardTitle, tLabel)}
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
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            <CardContent className="p-0">
              <CardBody
                card={card}
                isPriority={isPriority}
                link={{
                  image: linkImage,
                  onImageError: handleLinkImageError,
                  title: linkCardTitle,
                }}
                textInsets={textInsets}
              />
            </CardContent>
            {isProcessing ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full"
              >
                <div className="h-full w-1/3 animate-progress-slide rounded-full bg-foreground/30 motion-reduce:animate-none" />
              </div>
            ) : null}
          </UICard>

          {isSelectionMode && !isOptimistic && (
            <div className="pointer-events-none absolute -top-2 -left-2 z-10">
              <Checkbox
                aria-hidden="true"
                checked={isSelected}
                className="size-6 rounded-full border-foreground/25 bg-background shadow-sm ring-2 ring-background"
                tabIndex={-1}
              />
            </div>
          )}

          {showHoverSelect ? (
            <ShortcutTooltip keys={["X"]} label={t("menu.select")} side="top">
              <button
                aria-keyshortcuts="X"
                aria-label={t("menu.select")}
                className="absolute -top-2 -left-2 z-20 flex size-6 items-center justify-center rounded-full border border-foreground/25 bg-background text-muted-foreground opacity-0 shadow-sm ring-2 ring-background transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
                onClick={handleSelect}
                tabIndex={-1}
                type="button"
              >
                <Check className="size-3.5" strokeWidth={2.5} />
              </button>
            </ShortcutTooltip>
          ) : null}

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
                <QuickActionButton
                  label={t("menu.openLink")}
                  onClick={openLink}
                >
                  <ArrowUpRight />
                </QuickActionButton>
              )}
              {!card.isDeleted && (
                <QuickActionButton
                  label={
                    card.isFavorited ? t("menu.unfavorite") : t("menu.favorite")
                  }
                  onClick={handleToggleFavorite}
                  pressed={Boolean(card.isFavorited)}
                  shortcut={["F"]}
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
                  <QuickActionButton label={t("menu.moreActions")}>
                    <Ellipsis />
                  </QuickActionButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48"
                  onKeyDown={handleCardMenuShortcut}
                >
                  <CardMenuEntries
                    entries={menuItems}
                    Item={DropdownMenuItem}
                    Separator={DropdownMenuSeparator}
                    Shortcut={DropdownMenuShortcut}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48" onKeyDown={handleCardMenuShortcut}>
        <CardMenuEntries
          entries={menuItems}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
          Shortcut={ContextMenuShortcut}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});
