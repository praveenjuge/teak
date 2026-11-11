import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import type { DragEvent, KeyboardEvent } from "react";
import { memo, use, useRef } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  Folder as FolderIcon,
  FolderMinus,
  Heart,
  LoaderCircle,
  Pencil,
  Pin,
  RefreshCw,
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
import { englishTranslator } from "@/lib/englishTranslators";
import { openCardLink } from "@/lib/openCardLink";
import { useCopyCard } from "../../hooks/useCardClipboard";
import { useIsApplePlatform } from "../../hooks/useIsApplePlatform";
import { useReprocessCard } from "../../hooks/useReprocessCard";
import {
  actsWhileSelecting,
  type CardActionId,
  cardActionAvailable,
  cardActionKeyName,
  cardActionLabel,
  cardActionShortcut,
  cardAriaKeyShortcuts,
  copyCardShortcut,
  GRID_CARD_ACTIONS,
} from "../../lib/cardActions";
import {
  cardFileFormat,
  cardTitle,
  linkCardTitle as linkTitleOf,
  showsPictureTile,
} from "../../lib/cardTypes";
import { CARD_DRAG_TYPE } from "../../lib/folders";
import { isCopyCardKey } from "../../lib/gridKeys";
import type { LinkTitleTranslator } from "../../lib/linkTitle";
import { runMenuItemShortcut } from "../../lib/menuShortcuts";
import { prefetchCardModalMedia } from "../../lib/prefetchCardMedia";
import { cn } from "../../lib/utils";
import { preloadCardModal } from "../card-modal/LazyCardModal";
import {
  prefetchFileTextPreview,
  previewsAsText,
  textPreviewKey,
} from "../card-previews/fileTextPreviewCache";
import { FirstPaintCopyContext } from "../grids/firstPaintCopy";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import {
  CardActionIcon,
  cardActionIcon,
  cardActionIconClass,
} from "./CardActionIcon";
import { CardBody } from "./CardBody";
import {
  CardMenuEntries,
  type CardMenuEntry,
  QuickActionButton,
} from "./CardMenu";
import { isCardProcessing } from "./cardDisplay";
import { CARD_ID_ATTRIBUTE } from "./cardElement";
import { useLinkCardImage } from "./linkCardImage";
import type { CardProps, CardWithUrls } from "./types";
import { isOptimisticCard } from "./types";

const MAX_ACCESSIBLE_LABEL_LENGTH = 120;

type AccessibleLabelTranslator = TeakTranslator<"cards.accessibleLabel">;

const englishAccessibleLabel: AccessibleLabelTranslator = englishTranslator(
  "cards.accessibleLabel"
);

export function getCardAccessibleLabel(
  card: Pick<
    CardWithUrls,
    | "content"
    | "fileMetadata"
    | "metadata"
    | "metadataTitle"
    | "metadataTitleEdited"
    | "type"
    | "url"
  >,
  t: AccessibleLabelTranslator = englishAccessibleLabel,
  linkTitle?: LinkTitleTranslator
): string {
  const type = card.type || "card";
  const title = cardTitle(card, linkTitle);
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
  actions = GRID_CARD_ACTIONS,
  card,
  onAction,
  onClick,
  onEditFolders,
  onEditLink,
  isSelectionMode,
  isSelected,
  isPriority = false,
  isTabStop = true,
  nativeDrag = true,
  onRemoveFromFolder,
}: CardProps) {
  const t = useTranslations("cards");
  const tLabel = useTranslations("cards.accessibleLabel");
  const apple = useIsApplePlatform();
  const tLinkTitle = useTranslations("lib.linkTitle");
  const { copy: copyCard } = useCopyCard();
  const { pendingCardId: reprocessingCardId, reprocess } = useReprocessCard();
  const isOptimistic = isOptimisticCard(card._id);
  const isFirstPaintCopy = use(FirstPaintCopyContext);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileFormat = card.type === "document" ? cardFileFormat(card) : null;

  const prefetchDocumentPreview = () => {
    if (isOptimistic || !card.fileUrl || !previewsAsText(fileFormat)) {
      return;
    }

    void prefetchFileTextPreview({
      cacheKey: textPreviewKey({
        fileKey: card.fileKey,
        fileUrl: card.fileUrl,
      }),
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
    const rect = cardRef.current?.getBoundingClientRect();
    onClick?.(
      card,
      rect && {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    );
  };

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
      isCopyCardKey(event, apple) &&
      (window.getSelection()?.isCollapsed ?? true)
    ) {
      event.preventDefault();
      handleCopy();
    }
  };

  const offers = (action: CardActionId) =>
    actions.has(action) && cardActionAvailable(action, card);
  const canCopy = offers("copy");
  const runAction = (action: CardActionId) => {
    if (!isOptimistic) {
      onAction?.(action, card);
    }
  };

  const handleReprocess = () => {
    if (isOptimistic) {
      return;
    }
    void reprocess(card._id);
  };

  const handleCopy = () => {
    if (!isOptimistic) {
      copyCard(card);
    }
  };

  const openLink = () => {
    openCardLink(card);
  };

  const linkCardTitle = linkTitleOf(card, tLinkTitle);
  const { image: linkImage, onImageError: handleLinkImageError } =
    useLinkCardImage(card);

  const isProcessing =
    !(isOptimistic || card.isDeleted) && isCardProcessing(card);
  const showFavoriteMark = Boolean(card.isFavorited && !isOptimistic);
  const showPinMark = card.pinPosition !== undefined && !isOptimistic;
  const showQuickActions = !(isOptimistic || isSelectionMode);
  // Text makes room for the heart and pin marks, and on touch screens for
  // the More button that keeps showing beside them.
  const marks = Number(showFavoriteMark) + Number(showPinMark);
  let textInsets = ["", "pr-11", "pr-19"][marks] ?? "";
  if (showQuickActions) {
    textInsets = cn(
      textInsets,
      ["pointer-coarse:pr-11", "pointer-coarse:pr-20", "pointer-coarse:pr-28"][
        marks
      ]
    );
  }

  const canDrag =
    nativeDrag && !(isOptimistic || isSelectionMode || card.isDeleted);
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.clearData();
    event.dataTransfer.setData(CARD_DRAG_TYPE, card._id);
    event.dataTransfer.effectAllowed = "copy";
  };

  const copyLabel = cardActionLabel("copy", card);
  const copyMenuLabel = copyLabel ? t(`menu.${copyLabel}`) : "";

  // While cards are selected, F, T, E and Delete act on the selection, so
  // only the keys that still act on this card show.
  const shortcutFor = (action: CardActionId) =>
    isSelectionMode && !actsWhileSelecting(action)
      ? undefined
      : cardActionShortcut(action, apple);
  const actionEntry = (action: CardActionId): CardMenuEntry[] => {
    if (!offers(action)) {
      return [];
    }
    const label =
      action === "select" && isSelectionMode && isSelected
        ? "deselect"
        : cardActionLabel(action, card);
    return [
      {
        destructive: action === "deleteForever",
        icon: cardActionIcon(action, card),
        iconClassName: cardActionIconClass(action, card),
        id: action,
        label: label ? t(`menu.${label}`) : "",
        onSelect: () => runAction(action),
        shortcut: shortcutFor(action),
      },
    ];
  };
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
            onSelect: handleCopy,
            shortcut: copyCardShortcut(apple),
          },
        ]
      : []),
    ...actionEntry("select"),
    ...actionEntry("restore"),
    ...(offers("deleteForever")
      ? [
          { separator: "before-delete-forever" },
          ...actionEntry("deleteForever"),
        ]
      : []),
    ...actionEntry("addTags"),
    ...(onEditFolders && !card.isDeleted
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
    ...(onRemoveFromFolder && !card.isDeleted
      ? [
          {
            icon: FolderMinus,
            id: "removeFromFolder",
            label: t("menu.removeFromFolder"),
            onSelect: () => {
              if (!isOptimistic) {
                onRemoveFromFolder(card._id);
              }
            },
          },
        ]
      : []),
    ...actionEntry("favorite"),
    ...actionEntry("pin"),
    ...(onEditLink && !card.isDeleted && card.type === "link" && card.url
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
    ...(card.isDeleted
      ? []
      : [
          {
            disabled: reprocessingCardId === card._id,
            icon: RefreshCw,
            id: "refreshDetails",
            label: t("menu.refreshDetails"),
            onSelect: handleReprocess,
          },
        ]),
    ...actionEntry("archive"),
    ...(offers("moveToTrash")
      ? [{ separator: "before-delete" }, ...actionEntry("moveToTrash")]
      : []),
  ];

  const showHoverSelect =
    !(isOptimistic || isSelectionMode) && offers("select");
  const isMediaCard =
    showsPictureTile(card.type) ||
    (card.type === "link" && Boolean(linkImage)) ||
    (card.type === "palette" && Boolean(card.colors?.length));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={isOptimistic}>
        <div
          className="group/card relative"
          data-card-shell=""
          data-selected={isSelected || undefined}
        >
          <UICard
            aria-disabled={isOptimistic || undefined}
            aria-keyshortcuts={
              isOptimistic
                ? undefined
                : cardAriaKeyShortcuts(card, actions, {
                    apple,
                    selecting: Boolean(isSelectionMode),
                  })
            }
            aria-label={getCardAccessibleLabel(card, tLabel, tLinkTitle)}
            aria-pressed={isSelectionMode ? Boolean(isSelected) : undefined}
            className={cn(
              // The focus and selection rings sit on the tile itself (see
              // CARD_SURFACE), so a link's name line stays outside them.
              "relative scroll-my-20 rounded-2xl border-0 bg-transparent p-0 outline-none contain-layout contain-style",
              isOptimistic ? "cursor-default opacity-70" : "cursor-pointer",
              card.isDeleted && "opacity-60"
            )}
            {...{
              [CARD_ID_ATTRIBUTE]:
                isOptimistic || isFirstPaintCopy ? undefined : card._id,
            }}
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
            <ShortcutTooltip
              keys={[cardActionKeyName("select") ?? ""]}
              label={t("menu.select")}
              side="top"
            >
              <button
                aria-keyshortcuts={cardActionShortcut("select", apple)?.keys}
                aria-label={t("menu.select")}
                className="absolute -top-2 -left-2 z-20 flex size-6 items-center justify-center rounded-full border border-foreground/25 bg-background text-muted-foreground opacity-0 shadow-sm ring-2 ring-background transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 group-has-[[data-slot=card]:focus-visible]/card:opacity-100"
                onClick={() => runAction("select")}
                tabIndex={-1}
                type="button"
              >
                <Check className="size-3.5" strokeWidth={2.5} />
              </button>
            </ShortcutTooltip>
          ) : null}

          {showFavoriteMark || showPinMark ? (
            <div
              className={cn(
                "pointer-events-none absolute top-2.5 right-2.5 z-10 flex items-center gap-1 transition-opacity duration-150",
                showQuickActions &&
                  "pointer-coarse:right-11 group-hover/card:opacity-0 group-has-[[data-slot=card]:focus-visible]/card:opacity-0"
              )}
            >
              {showPinMark ? (
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full",
                    isMediaCard &&
                      "bg-background/85 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10"
                  )}
                  data-pin-mark=""
                >
                  <Pin
                    aria-label={t("pinnedMark")}
                    className="size-3.5 fill-foreground text-foreground"
                    role="img"
                  />
                </span>
              ) : null}
              {showFavoriteMark ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full",
                    isMediaCard &&
                      "bg-background/85 shadow-sm ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10"
                  )}
                >
                  <Heart className="size-3.5 fill-destructive text-destructive" />
                </span>
              ) : null}
            </div>
          ) : null}

          {showQuickActions && (
            <div className="pointer-events-none pointer-coarse:pointer-events-auto absolute top-2.5 right-2.5 z-20 flex items-center gap-1 opacity-0 pointer-coarse:opacity-100 transition-opacity duration-150 group-hover/card:pointer-events-auto group-hover/card:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 group-has-[[data-slot=card]:focus-visible]/card:opacity-100">
              {/* Without hover, only More shows: it holds every action. */}
              {card.url && !card.isDeleted && (
                <QuickActionButton
                  className="pointer-coarse:hidden"
                  label={t("menu.openLink")}
                  onClick={openLink}
                >
                  <ArrowUpRight />
                </QuickActionButton>
              )}
              {offers("favorite") && (
                <QuickActionButton
                  className="pointer-coarse:hidden"
                  label={t(
                    `menu.${cardActionLabel("favorite", card) ?? "favorite"}`
                  )}
                  onClick={() => runAction("favorite")}
                  pressed={Boolean(card.isFavorited)}
                  shortcut={[cardActionKeyName("favorite") ?? ""]}
                >
                  <CardActionIcon action="favorite" card={card} />
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
                  onKeyDown={runMenuItemShortcut}
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

      <ContextMenuContent className="w-48" onKeyDown={runMenuItemShortcut}>
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
