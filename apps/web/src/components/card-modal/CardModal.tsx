import { opensOnRead } from "@teak/convex/shared/article";
import { cardLinkTokensToText } from "@teak/convex/shared/cardLinks";
import type { CardType } from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  Copy,
  Download,
  Ellipsis,
  FileDown,
  FolderPlus,
  Heart,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash,
  X,
} from "vadivam-react";
import { ArticleReader, articleReaderState } from "@/components/card-previews";
import type {
  HighlightJump,
  ReaderHighlightControls,
} from "@/components/card-previews/ArticleHighlights";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CardHighlightsControl } from "@/hooks/useCardHighlights";
import type { PaletteColorsControl } from "@/hooks/usePaletteColors";
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import type { CardSaveState } from "../../hooks/useCardModal";
import { useIsMobile } from "../../hooks/useIsMobile";
import { CARD_DIALOG_ATTRIBUTE } from "../../hooks/useKeyboardShortcuts";
import type { LinkThumbnailControl } from "../../hooks/useLinkThumbnail";
import { useRetainedWhileClosing } from "../../hooks/useRetainedWhileClosing";
import { useStableHandlers } from "../../hooks/useStableHandlers";
import { readCardOpenOrigin } from "../../lib/cardOpenOrigin";
import { cardMenuShortcuts } from "../../lib/keyboardShortcuts";
import {
  firstFile,
  imageFromClipboard,
  isTextEntryTarget,
  LINK_THUMBNAIL_ACCEPT,
} from "../../lib/linkThumbnail";
import { cn } from "../../lib/utils";
import { AudioPreview } from "../card-previews/AudioPreview";
import { DocumentPreview } from "../card-previews/DocumentPreview";
import { ImagePreview } from "../card-previews/ImagePreview";
import { LinkPreview } from "../card-previews/LinkPreview";
import { QuotePreview } from "../card-previews/QuotePreview";
import { TextPreview } from "../card-previews/TextPreview";
import { VideoPreview } from "../card-previews/VideoPreview";
import { getDisplayHostname } from "../cards/cardDisplay";
import { cardTypeLabel } from "../cards/cardTypeLabel";
import { EditLinkDialog } from "../cards/EditLinkDialog";
import { CardFoldersDialog } from "../folders/CardFoldersDialog";
import { useGlobalFileDrop } from "../providers/GlobalFileDropProvider";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import type { CardLinkOptions } from "../text-editor/types";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
  type CardBacklinks,
  CardMetadataPanel,
  type CardTagsControl,
  type SavePdfControl,
} from "./CardMetadataPanel";
import { CardModalSkeleton } from "./CardModalSkeleton";
import {
  ActionCell,
  SIDEBAR_PRIMARY_CLASS,
  SIDEBAR_PRIMARY_COMPACT_CLASS,
  SidebarTitle,
  useScrolledPast,
} from "./CardSidebarHeader";
import { CheckedLinkPreview } from "./CheckedLinkPreview";
import { formatAddedDate, getCardHeading } from "./cardHeading";
import {
  CARD_MODAL_OVERLAY_CLASS,
  CARD_MODAL_SURFACE_CLASS,
  cardModalFrameClass,
  GUTTER_CLOSE_STYLE,
  gutterNavStyle,
} from "./cardModalFrame";
import { cardModalKeyAction, escapeClosesOverTooltip } from "./cardModalKeys";
import { emptiedContentNotice, saveStateLabel } from "./cardModalText";
import { getCardTypeIconComponent } from "./cardTypeIcon";
import { HeaderIconButton } from "./HeaderIconButton";
import { PaletteStage } from "./PaletteStage";
import type { CardModalCard, GetCurrentValue } from "./types";
import { useCardSteps } from "./useCardSteps";
import { EMPTY_CONTENT_TOAST_ID, useLeaveGuard } from "./useLeaveGuard";
import { useSaveStatus } from "./useSaveStatus";

export const AUTOSAVE_DELAY_MS = 800;

export { emptiedContentNotice } from "./cardModalText";

function CardPreview({
  card,
  cardLinks,
  getCurrentValue,
  paletteColors,
  saveChanges,
  thumbnail,
  updateContent,
}: {
  card: CardModalCard;
  cardLinks?: CardLinkOptions;
  getCurrentValue: GetCurrentValue;
  paletteColors?: PaletteColorsControl;
  saveChanges: () => void;
  thumbnail?: LinkThumbnailControl;
  updateContent: (value: string) => void;
}) {
  switch (card.type) {
    case "text":
      return (
        <TextPreview
          card={card}
          cardLinks={cardLinks}
          getCurrentValue={getCurrentValue}
          onContentChange={updateContent}
          onSaveShortcut={saveChanges}
          readOnly={Boolean(card.isDeleted)}
        />
      );
    case "quote":
      return (
        <QuotePreview
          card={card}
          getCurrentValue={getCurrentValue}
          onContentChange={updateContent}
          readOnly={Boolean(card.isDeleted)}
        />
      );
    case "link": {
      const linkThumbnail =
        thumbnail && !card.isDeleted
          ? {
              onFile: (file: File) => thumbnail.replace(file, "drop"),
              uploadingPreviewUrl: thumbnail.uploadingPreviewUrl,
            }
          : undefined;
      return card.pageArchive && !card.isDeleted ? (
        <CheckedLinkPreview
          card={card}
          showScreenshot
          thumbnail={linkThumbnail}
        />
      ) : (
        <LinkPreview card={card} showScreenshot thumbnail={linkThumbnail} />
      );
    }
    case "image":
      return <ImagePreview card={card} />;
    case "video":
      return <VideoPreview card={card} />;
    case "audio":
      return <AudioPreview card={card} />;
    case "document":
      return <DocumentPreview card={card} />;
    case "palette":
      return <PaletteStage card={card} colors={paletteColors} />;
    default:
      return <div className="whitespace-pre-wrap">{card.content}</div>;
  }
}

function stageContentClass(card: CardModalCard): string {
  switch (card.type) {
    case "image":
      return "flex min-h-full items-center justify-center p-4 md:h-full md:p-8";
    case "video":
      return "flex items-center justify-center bg-black max-md:aspect-video md:h-full";
    case "document": {
      const format = card.fileMetadata?.fileName
        ? inferFileFormat({
            fileName: card.fileMetadata.fileName,
            mimeType: card.fileMetadata.mimeType,
          })
        : null;
      return format?.preview === "pdf" && card.fileUrl
        ? "h-[70dvh] p-2 md:h-full md:p-3"
        : "p-5 md:p-8";
    }
    case "link":
      return "px-5 pt-5 pb-6 md:px-10 md:pt-8 md:pb-10";
    case "text":
      return "mx-auto w-full max-w-3xl px-5 pt-5 pb-6 md:px-10 md:pt-10 md:pb-12";
    default:
      return "flex min-h-full items-center justify-center p-5 md:p-10";
  }
}

const READ_STAGE_CLASS = "px-5 py-8 md:px-10 md:py-12";

/** Preview · Read: the chosen one is filled, so it reads at a glance. */
export const STAGE_VIEW_ITEM_CLASS =
  "px-3 data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:hover:bg-foreground/90 data-[state=on]:hover:text-background";

type StageView = "preview" | "read";

const useStageView = (
  card: CardModalCard | null | undefined,
  open: boolean
) => {
  const [choice, setChoice] = useState<{
    cardId: string;
    view: StageView;
  } | null>(null);
  const available = card ? articleReaderState(card).kind !== "none" : false;
  const fallback: StageView = opensOnRead(
    card?.metadata?.linkCategory?.category
  )
    ? "read"
    : "preview";
  let view: StageView = "preview";
  if (card && available) {
    view = choice?.cardId === card._id ? choice.view : fallback;
  }

  const mainRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, [number, number]>());
  const cardId = card?._id;
  const remember = () => {
    if (cardId) {
      positions.current.set(`${cardId}:${view}`, [
        mainRef.current?.scrollTop ?? 0,
        scrollerRef.current?.scrollTop ?? 0,
      ]);
    }
  };
  const setView = (next: StageView) => {
    if (!cardId || next === view) {
      return;
    }
    remember();
    setChoice({ cardId, view: next });
  };
  useLayoutEffect(() => {
    if (!cardId) {
      return;
    }
    const [main, scroller] = positions.current.get(`${cardId}:${view}`) ?? [
      0, 0,
    ];
    if (mainRef.current) {
      mainRef.current.scrollTop = main;
    }
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scroller;
    }
  }, [cardId, view]);
  useEffect(() => {
    if (!open) {
      positions.current.clear();
      setChoice(null);
    }
  }, [open]);

  return {
    available,
    mainRef,
    scrollerRef,
    setView,
    toggle: () => setView(view === "read" ? "preview" : "read"),
    view,
  };
};

const DIALOG_KEYS = {
  copy: { keys: "C" },
  done: { keys: "D" },
  favorite: { keys: "F" },
} as const;

interface SidebarAction {
  caption: string;
  icon: ReactNode;
  id: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  shortcut?: readonly string[];
  tone?: "primary";
}

interface CardModalProps {
  backlinks?: CardBacklinks;
  card?: CardModalCard | null;
  cardId?: string | null;
  cardLinks?: CardLinkOptions;
  downloadFile: () => void;
  getCurrentValue: GetCurrentValue;
  handleDelete: (onClose?: () => void) => Promise<void>;
  handlePermanentDelete: (onClose?: () => void) => Promise<void>;
  handleRestore: (onClose?: () => void) => Promise<void>;
  hasUnsavedChanges: boolean;
  highlights?: CardHighlightsControl;
  isDownloading?: boolean;
  isReprocessing?: boolean;
  linkThumbnail?: LinkThumbnailControl;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onMoreLikeThis?: (cardId: string) => void;
  onNext?: () => void;
  onOpenCard?: (cardId: string) => void;
  onPrevious?: () => void;
  onReprocess?: () => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
  openLink: () => void;
  paletteColors?: PaletteColorsControl;
  returnFocus?: (cardId: string) => boolean;
  saveChanges: (options?: { silent?: boolean }) => Promise<boolean>;
  savePdf?: SavePdfControl;
  saveState: CardSaveState;
  tags: Omit<CardTagsControl, "inputRef">;
  toggleArchive?: () => void;
  toggleDone?: () => void;
  toggleFavorite: () => void;
  updateContent: (value: string) => void;
  updateNotes: (value: string) => void;
  updateTitle: (value: string | undefined) => void;
}

export function CardModal({
  backlinks,
  card: cardProp,
  cardId,
  cardLinks,
  open,
  onCancel,
  onCardTypeClick,
  onNext,
  onOpenCard,
  onPrevious,
  onTagClick,
  onMoreLikeThis,
  hasUnsavedChanges,
  getCurrentValue,
  updateContent,
  updateNotes,
  updateTitle,
  toggleArchive,
  toggleDone,
  toggleFavorite,
  handleDelete,
  handleRestore,
  handlePermanentDelete,
  highlights,
  openLink,
  paletteColors,
  downloadFile,
  saveChanges,
  savePdf,
  saveState,
  tags,
  isDownloading,
  isReprocessing,
  linkThumbnail,
  onReprocess,
  returnFocus,
}: CardModalProps) {
  const t = useTranslations("cardModal");
  const tc = useTranslations("common");
  const tHeading = useTranslations("cardModal.heading");
  const types = useTranslations("cards.types");
  const tLinkTitle = useTranslations("lib.linkTitle");
  const tDialog = useTranslations("cards.deleteForeverDialog");
  const tDetails = useTranslations("cardModal.details");
  const dateLocale = useIntlLocale(US_ENGLISH_LOCALE);
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] =
    useState(false);
  const [isFoldersOpen, setIsFoldersOpen] = useState(false);
  const [isEditLinkOpen, setIsEditLinkOpen] = useState(false);
  const card = useRetainedWhileClosing(cardProp, open);
  const contentRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const asideRef = useRef<HTMLElement>(null);
  const [actionsElement, setActionsElement] = useState<HTMLDivElement | null>(
    null
  );
  const actionsScrolledPast = useScrolledPast(asideRef, actionsElement);

  const saveStatus = useSaveStatus(saveState);
  const stage = useStageView(card, open);
  const readerControls = useRef<ReaderHighlightControls | null>(null);
  const [highlightJump, setHighlightJump] = useState<HighlightJump | null>(
    null
  );
  const readingCard = stage.view === "read" ? card?._id : undefined;
  useEffect(() => {
    if (!readingCard) {
      setHighlightJump(null);
    }
  }, [readingCard]);
  const jumpToHighlight = (highlightId: string) => {
    stage.setView("read");
    setHighlightJump((last) => ({
      id: highlightId,
      seq: (last?.seq ?? 0) + 1,
    }));
  };

  const originRef = useRef<{ open: boolean; value?: string }>({ open: false });
  if (originRef.current.open !== open) {
    originRef.current = {
      open,
      value:
        open && cardId && typeof window !== "undefined"
          ? readCardOpenOrigin(cardId, {
              height: window.innerHeight,
              width: window.innerWidth,
            })
          : undefined,
    };
  }
  const openOrigin = originRef.current.value;

  useEffect(() => {
    if (!(open && hasUnsavedChanges)) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveChanges({ silent: true });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, hasUnsavedChanges, saveChanges]);

  // The pinned bar leaves as the actions scroll back in. A control in it
  // that had focus goes with it, so focus returns to the card, keeping its
  // keys alive.
  useEffect(() => {
    if (!actionsScrolledPast && document.activeElement === document.body) {
      contentRef.current?.focus({ preventScroll: true });
    }
  }, [actionsScrolledPast]);

  const imageControl =
    card?.type === "link" && !card.isDeleted ? linkThumbnail : undefined;

  const canPasteImage = Boolean(open && imageControl);
  const claimPaste = useGlobalFileDrop()?.claimPaste;
  useEffect(() => {
    if (!(canPasteImage && linkThumbnail && claimPaste)) {
      return;
    }
    return claimPaste((event) => {
      if (isTextEntryTarget(event.target)) {
        return false;
      }
      const file = imageFromClipboard(event.clipboardData);
      if (!file) {
        return false;
      }
      event.preventDefault();
      linkThumbnail.replace(file, "paste");
      return true;
    });
  }, [canPasteImage, claimPaste, linkThumbnail]);

  const commit = () => {
    if (hasUnsavedChanges) {
      void saveChanges({ silent: true });
    }
  };

  const discardNotice = emptiedContentNotice(card, getCurrentValue, t);
  const { noteEdit, readyToLeave } = useLeaveGuard({
    cardId,
    discardNotice,
    hasUnsavedChanges,
    saveChanges,
  });
  const editContent = (value: string) => {
    if (card?.isDeleted) {
      return;
    }
    noteEdit();
    updateContent(value);
  };
  const editNotes = (value: string) => {
    noteEdit();
    updateNotes(value);
  };
  const editTitle = (value: string | undefined) => {
    noteEdit();
    updateTitle(value);
  };

  const handleClose = async () => {
    if (await readyToLeave()) {
      onCancel?.();
    }
  };

  // An open tooltip is a layer above the dialog and takes the first Escape
  // for itself. Window capture runs before every layer's own listener, so
  // here one Escape does what the dialog's own Escape does.
  const escapeRef = useRef(handleClose);
  useEffect(() => {
    escapeRef.current = handleClose;
  });
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        !escapeClosesOverTooltip(contentRef.current)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!readerControls.current?.dismiss()) {
        void escapeRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const closeAfterAction = async ({ keepsCard = false } = {}) => {
    if (hasUnsavedChanges) {
      await saveChanges({ silent: true });
    }
    if (keepsCard && discardNotice) {
      toast(discardNotice, { id: EMPTY_CONTENT_TOAST_ID });
    }
    onCancel?.();
  };

  const goTo = async (show?: () => void) => {
    if (!show) {
      return;
    }
    if (await readyToLeave()) {
      show();
    }
  };

  const step = useCardSteps({
    cardId,
    onNext,
    onPrevious,
    open,
    readyToLeave,
  });

  // A pill or a Linked from row opens its card through goTo, so unsaved
  // edits save first, as they do before each step.
  const linkHandlers = useStableHandlers({
    openBacklink: (linkedCardId: string) => {
      void goTo(() => onOpenCard?.(linkedCardId));
    },
    openPill: (linkedCardId: string) => {
      void goTo(() => cardLinks?.onOpenCard?.(linkedCardId));
    },
  });
  const openLinkedCard = onOpenCard ? linkHandlers.openBacklink : undefined;
  const guardedCardLinks = useMemo(
    () =>
      cardLinks && {
        ...cardLinks,
        onOpenCard: cardLinks.onOpenCard ? linkHandlers.openPill : undefined,
      },
    [cardLinks, linkHandlers]
  );

  const isDeleted = Boolean(card?.isDeleted);
  const canDownload = Boolean(
    card?.fileKey && ["document", "audio", "video", "image"].includes(card.type)
  );
  const copyableText =
    card?.type === "text" || card?.type === "quote"
      ? cardLinkTokensToText(getCurrentValue("content") ?? "")
      : "";
  const canToggleDone = Boolean(
    toggleDone && card?.type === "link" && !isDeleted
  );
  const isDone = card?.completedAt !== undefined;
  const doneVerb = doneActionLabel(card?.metadata?.linkCategory?.category);
  const doneMenuLabel = isDone
    ? t("done.markAsNot", { verb: doneVerb })
    : t("done.markAs", { verb: doneVerb });

  const archive = () => {
    if (toggleArchive && !isDeleted) {
      toggleArchive();
      void closeAfterAction({ keepsCard: true });
    }
  };

  const primaryAction = () => {
    if (card?.url && !isDeleted) {
      openLink();
    } else if (canDownload && !isDownloading) {
      downloadFile();
    }
  };

  const copyFailed = t("toasts.copyFailed");
  const copyCard = () => {
    if (card?.url) {
      void copyToClipboard(card.url, t("toasts.copiedLink"), copyFailed);
    } else if (copyableText) {
      void copyToClipboard(copyableText, t("toasts.copiedText"), copyFailed);
    }
  };

  const focusPanelField = (field: "notes" | "tags") => {
    (field === "notes" ? notesRef : tagInputRef).current?.focus();
  };

  // Add to folder opens once the menu has closed. Opened at once, the
  // closing menu took focus back from it and then unmounted, leaving focus
  // on the page, so every card key went dead after the dialog closed.
  const foldersAfterMenu = useRef<boolean>(false);
  const openFoldersFromMenu = () => {
    foldersAfterMenu.current = true;
  };
  const onMenuCloseAutoFocus = (event: Event) => {
    if (!foldersAfterMenu.current) {
      return;
    }
    foldersAfterMenu.current = false;
    event.preventDefault();
    // The dialog gives focus back to what had it when it opened: the card.
    contentRef.current?.focus();
    setIsFoldersOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      !card ||
      !contentRef.current?.contains(event.target as Node)
    ) {
      return;
    }
    const action = cardModalKeyAction({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      isComposing: event.nativeEvent.isComposing,
      key: event.key,
      metaKey: event.metaKey,
      repeat: event.repeat,
      shiftKey: event.shiftKey,
      target: event.target,
    });
    if (!action) {
      return;
    }
    event.preventDefault();
    switch (action) {
      case "previous":
        step(-1, { repeat: event.repeat });
        break;
      case "next":
        step(1, { repeat: event.repeat });
        break;
      case "favorite":
        if (!isDeleted) {
          toggleFavorite();
        }
        break;
      case "archive":
        archive();
        break;
      case "delete":
        if (!isDeleted) {
          void handleDelete(closeAfterAction);
        }
        break;
      case "focusTags":
        if (!isDeleted) {
          focusPanelField("tags");
        }
        break;
      case "focusNotes":
        if (!isDeleted) {
          focusPanelField("notes");
        }
        break;
      case "done":
        if (canToggleDone) {
          toggleDone?.();
        }
        break;
      case "open":
        primaryAction();
        break;
      case "copy":
        copyCard();
        break;
      case "toggleReader":
        if (stage.available) {
          stage.toggle();
        }
        break;
      case "highlight":
        if (stage.view === "read") {
          readerControls.current?.highlightSelection();
        }
        break;
      default:
        break;
    }
  };

  const menuShortcuts = cardMenuShortcuts();
  const heading = card
    ? getCardHeading(card, { link: tLinkTitle, t: tHeading, types })
    : null;
  const hostname =
    card?.type === "link" ? getDisplayHostname(card.url) : undefined;
  const typeLabel = cardTypeLabel(card?.type, types);
  const TypeIcon = getCardTypeIconComponent(card?.type as CardType | undefined);
  const editedTitle = getCurrentValue("metadataTitle");
  const titleValue =
    card && editedTitle !== card.metadataTitle
      ? (editedTitle ?? "")
      : (heading?.title ?? "");
  const showTitle = Boolean(
    heading &&
      (heading.editable || heading.title !== typeLabel) &&
      !(card?.type === "text" || card?.type === "quote")
  );
  const addedLabel = card
    ? formatAddedDate(card.createdAt, undefined, {
        locale: dateLocale,
        t: tHeading,
      })
    : "";
  const saveStatusLabel = saveStatus
    ? saveStateLabel(saveStatus, t, tc)
    : undefined;

  const favoriteLabel = card?.isFavorited
    ? t("menu.unfavorite")
    : t("menu.favorite");
  const copyLabel = card?.url ? t("menu.copyLink") : t("menu.copyText");
  const moreLabel = t("menu.moreActions");

  // `quiet` is the trash sidebar's secondary Download, under Restore.
  const primaryButton = (style: "full" | "compact" | "quiet"): ReactNode => {
    const className = {
      full: SIDEBAR_PRIMARY_CLASS,
      compact: SIDEBAR_PRIMARY_COMPACT_CLASS,
      quiet: "h-8 w-full rounded-full",
    }[style];
    const variant = style === "quiet" ? "secondary" : undefined;
    if (card?.url && !isDeleted) {
      return (
        <ShortcutTooltip keys={["O"]} label={t("header.openTooltip")}>
          <Button
            aria-keyshortcuts="O"
            className={className}
            onClick={openLink}
            size="sm"
          >
            {t("header.open")}
            <ArrowUpRight />
          </Button>
        </ShortcutTooltip>
      );
    }
    // A file with a URL downloads from the menu, which Trash doesn't have.
    if (canDownload && (!card?.url || style === "quiet")) {
      return (
        <ShortcutTooltip keys={["O"]} label={t("header.downloadTooltip")}>
          <Button
            aria-busy={isDownloading}
            aria-keyshortcuts="O"
            className={className}
            disabled={isDownloading}
            onClick={downloadFile}
            size="sm"
            variant={variant}
          >
            {isDownloading ? <Spinner /> : <Download />}
            {isDownloading ? t("header.downloading") : t("header.download")}
          </Button>
        </ShortcutTooltip>
      );
    }
    return null;
  };

  const sidebarActions: SidebarAction[] = [];
  if (card && !isDeleted) {
    sidebarActions.push({
      caption: t("menu.favorite"),
      icon: (
        <Heart
          className={cn(
            card.isFavorited && "fill-destructive text-destructive"
          )}
        />
      ),
      id: "favorite",
      label: favoriteLabel,
      onClick: toggleFavorite,
      pressed: Boolean(card.isFavorited),
      shortcut: ["F"],
    });
    if (canToggleDone && toggleDone) {
      sidebarActions.push({
        // "Done", never "Read": the reader's own toggle is called Read.
        caption: t("done.caption"),
        icon: isDone ? <CircleCheck /> : <Circle />,
        id: "done",
        label: isDone
          ? t("done.marked", { verb: doneVerb })
          : t("done.markAs", { verb: doneVerb }),
        onClick: toggleDone,
        pressed: isDone,
        shortcut: ["D"],
        tone: "primary",
      });
    }
    if (card.url || copyableText) {
      sidebarActions.push({
        caption: tc("copy"),
        icon: <Copy />,
        id: "copy",
        label: copyLabel,
        onClick: copyCard,
        shortcut: ["C"],
      });
    }
    sidebarActions.push({
      caption: t("actions.folder"),
      icon: <FolderPlus />,
      id: "folder",
      label: t("menu.addToFolder"),
      onClick: () => setIsFoldersOpen(true),
    });
  }

  // On a wide screen the sidebar's icon row holds favorite, done, copy and
  // folders, so the menu keeps only what's left. Phones keep them all.
  const menuGroups: ReactNode[][] = [];
  if (card) {
    if (isMobile && !isDeleted) {
      menuGroups.push([
        <DropdownMenuItem
          aria-keyshortcuts={DIALOG_KEYS.favorite.keys}
          key="favorite"
          onClick={toggleFavorite}
        >
          <Heart />
          {favoriteLabel}
        </DropdownMenuItem>,
        canToggleDone ? (
          <DropdownMenuItem
            aria-keyshortcuts={DIALOG_KEYS.done.keys}
            key="done"
            onClick={toggleDone}
          >
            {isDone ? <CircleCheck /> : <Circle />}
            {doneMenuLabel}
          </DropdownMenuItem>
        ) : null,
        <DropdownMenuItem key="folder" onClick={openFoldersFromMenu}>
          <FolderPlus />
          {t("menu.addToFolder")}
        </DropdownMenuItem>,
      ]);
    }
    if (isMobile && (card.url || copyableText)) {
      menuGroups.push([
        <DropdownMenuItem
          aria-keyshortcuts={DIALOG_KEYS.copy.keys}
          key="copy"
          onClick={copyCard}
        >
          <Copy />
          {copyLabel}
        </DropdownMenuItem>,
      ]);
    }
    menuGroups.push([
      canDownload && card.url ? (
        <DropdownMenuItem
          disabled={isDownloading}
          key="download"
          onClick={downloadFile}
        >
          <Download />
          {t("menu.download")}
        </DropdownMenuItem>
      ) : null,
      savePdf && !isDeleted ? (
        <DropdownMenuItem
          aria-busy={savePdf.isSaving}
          disabled={savePdf.isSaving}
          key="pdf"
          onClick={savePdf.save}
        >
          {savePdf.isSaving ? <Spinner /> : <FileDown />}
          {savePdf.isSaving ? t("menu.savingPdf") : t("menu.savePdf")}
        </DropdownMenuItem>
      ) : null,
    ]);
    if (!isDeleted) {
      menuGroups.push([
        onMoreLikeThis ? (
          <DropdownMenuItem
            key="more-like-this"
            onClick={() => onMoreLikeThis(card._id)}
          >
            <Sparkles />
            {t("menu.moreLikeThis")}
          </DropdownMenuItem>
        ) : null,
        onReprocess ? (
          <DropdownMenuItem
            disabled={isReprocessing}
            key="refresh"
            onClick={onReprocess}
          >
            {isReprocessing ? <Spinner /> : <RefreshCw />}
            {t("menu.refreshDetails")}
          </DropdownMenuItem>
        ) : null,
      ]);
      menuGroups.push([
        toggleArchive ? (
          <DropdownMenuItem
            aria-keyshortcuts={menuShortcuts.archive.keys}
            key="archive"
            onClick={archive}
          >
            {card.isArchived ? <ArchiveRestore /> : <Archive />}
            {card.isArchived ? t("menu.unarchive") : t("menu.archive")}
            <DropdownMenuShortcut aria-hidden>
              {menuShortcuts.archive.label}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null,
        <DropdownMenuItem
          aria-keyshortcuts={menuShortcuts.delete.keys}
          key="trash"
          onClick={() => void handleDelete(closeAfterAction)}
          variant="destructive"
        >
          <Trash />
          {t("menu.moveToTrash")}
          <DropdownMenuShortcut aria-hidden>
            {menuShortcuts.delete.label}
          </DropdownMenuShortcut>
        </DropdownMenuItem>,
      ]);
    }
  }
  const shownMenuGroups = menuGroups
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length > 0);

  const renderMenu = (trigger: ReactNode) =>
    shownMenuGroups.length > 0 ? (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={onMenuCloseAutoFocus}
        >
          {shownMenuGroups.map((group, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: groups keep their order.
            <Fragment key={index}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>{group}</DropdownMenuGroup>
            </Fragment>
          ))}
          {isMobile ? null : (
            <DropdownMenuLabel className="mt-1 border-t pt-2 font-normal text-muted-foreground text-xs">
              {t.rich("menu.shortcutsHint", {
                kbd: (chunks) => <kbd className="font-sans">{chunks}</kbd>,
              })}
            </DropdownMenuLabel>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const closeButton = (
    <DialogClose asChild>
      <HeaderIconButton
        className={cn(
          !isMobile &&
            "absolute size-9 bg-background/90 text-foreground shadow-md ring-1 ring-border/60 hover:bg-background"
        )}
        label={tc("close")}
        shortcut={["Esc"]}
        style={isMobile ? undefined : GUTTER_CLOSE_STYLE}
      >
        <X />
      </HeaderIconButton>
    </DialogClose>
  );

  const sidebarTitle =
    card && heading ? (
      <SidebarTitle
        added={addedLabel}
        editable={heading.editable && !isDeleted}
        hostname={hostname}
        label={t("header.titleLabel")}
        onCommit={commit}
        onTitleChange={editTitle}
        onTypeClick={
          onCardTypeClick ? () => onCardTypeClick(card.type) : undefined
        }
        placeholder={t("header.titlePlaceholder")}
        saveStatus={
          !isMobile && saveStatusLabel
            ? { error: saveStatus === "error", label: saveStatusLabel }
            : null
        }
        showTitle={showTitle}
        title={heading.title}
        titleValue={titleValue}
        typeIcon={<TypeIcon aria-hidden="true" />}
        typeLabel={typeLabel}
        typeTitle={tDetails("showAllOfType", { type: card.type ?? "card" })}
      />
    ) : null;

  const trashBlock = isDeleted ? (
    <div className="space-y-2">
      <p
        className="flex items-center gap-1.5 text-muted-foreground text-sm"
        role="status"
      >
        <Trash aria-hidden="true" className="size-3.5" />
        {t("trash.inTrash")}
      </p>
      <Button
        className={SIDEBAR_PRIMARY_CLASS}
        onClick={() => void handleRestore(closeAfterAction)}
        size="sm"
      >
        <RotateCcw />
        {t("trash.restore")}
      </Button>
      {isMobile ? null : primaryButton("quiet")}
      <Button
        className="h-8 w-full rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setIsPermanentDeleteConfirmOpen(true)}
        size="sm"
        variant="ghost"
      >
        <Trash />
        {t("trash.deleteForever")}
      </Button>
    </div>
  ) : null;

  const showsSidebarActions = Boolean(card && !isDeleted && !isMobile);
  const actionBlock = showsSidebarActions ? (
    <div className="space-y-2" ref={setActionsElement}>
      {primaryButton("full")}
      <div className="grid auto-cols-fr grid-flow-col gap-0.5">
        {sidebarActions.map((action) => (
          <ActionCell
            caption={action.caption}
            key={action.id}
            label={action.label}
            onClick={action.onClick}
            pressed={action.pressed}
            shortcut={action.shortcut}
            tone={action.tone}
          >
            {action.icon}
          </ActionCell>
        ))}
        {renderMenu(
          <ActionCell caption={tc("more")} label={moreLabel}>
            <Ellipsis />
          </ActionCell>
        )}
      </div>
    </div>
  ) : null;

  const pinnedActions =
    showsSidebarActions && actionsScrolledPast ? (
      <div className="sticky top-0 z-20 h-0">
        <div
          className="fade-in-0 slide-in-from-top-1 flex animate-in items-center gap-1 border-border/60 border-b bg-background/95 px-5 py-2 backdrop-blur duration-150"
          data-testid="pinned-card-actions"
        >
          {primaryButton("compact")}
          <span className="flex-1" />
          {sidebarActions.map((action) => (
            <HeaderIconButton
              className={cn(
                action.pressed && action.tone === "primary" && "text-primary"
              )}
              key={action.id}
              label={action.label}
              onClick={action.onClick}
              pressed={action.pressed}
              shortcut={action.shortcut}
            >
              {action.icon}
            </HeaderIconButton>
          ))}
          {renderMenu(
            <HeaderIconButton label={moreLabel}>
              <Ellipsis />
            </HeaderIconButton>
          )}
        </div>
      </div>
    ) : null;

  const navButton = (direction: "previous" | "next") => {
    const show = direction === "previous" ? onPrevious : onNext;
    return (
      <HeaderIconButton
        className={cn(
          // Disabled at either end, it still catches a quick extra click,
          // which would otherwise land on the backdrop and close the card.
          "absolute top-1/2 size-10 -translate-y-1/2 bg-background/90 text-foreground shadow-md ring-1 ring-border/60 hover:bg-background disabled:pointer-events-auto disabled:cursor-default disabled:opacity-0 [&_svg]:size-5"
        )}
        disabled={!show}
        label={
          direction === "previous"
            ? t("header.previousCard")
            : t("header.nextCard")
        }
        onClick={() => step(direction === "previous" ? -1 : 1)}
        shortcut={[direction === "previous" ? "←" : "→"]}
        style={gutterNavStyle(direction === "previous" ? "left" : "right")}
        tooltipSide={direction === "previous" ? "right" : "left"}
      >
        {direction === "previous" ? <ChevronLeft /> : <ChevronRight />}
      </HeaderIconButton>
    );
  };

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            void handleClose();
          }
        }}
        open={open}
      >
        <DialogContent
          {...{ [CARD_DIALOG_ATTRIBUTE]: "" }}
          className={cn(
            cardModalFrameClass(card?.type),
            openOrigin &&
              "md:data-[state=open]:zoom-in-[0.7] md:data-[state=open]:duration-200 md:data-[state=open]:ease-out"
          )}
          onCloseAutoFocus={(event) => {
            if (card && returnFocus?.(card._id)) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (readerControls.current?.dismiss()) {
              event.preventDefault();
            }
          }}
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          overlayClassName={CARD_MODAL_OVERLAY_CLASS}
          ref={contentRef}
          showCloseButton={false}
          style={openOrigin ? { transformOrigin: openOrigin } : undefined}
        >
          {card && heading ? (
            <>
              {imageControl ? (
                <input
                  accept={LINK_THUMBNAIL_ACCEPT}
                  aria-hidden="true"
                  className="sr-only"
                  data-testid="link-image-input"
                  onChange={(event) => {
                    const file = firstFile(event.target.files);
                    event.target.value = "";
                    if (file) {
                      imageControl.replace(file, "pick");
                    }
                  }}
                  ref={imageInputRef}
                  tabIndex={-1}
                  type="file"
                />
              ) : null}

              <div className={CARD_MODAL_SURFACE_CLASS}>
                {isMobile ? (
                  <header className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-muted-foreground text-xs",
                        saveStatus === "error" && "text-destructive"
                      )}
                      role="status"
                    >
                      {saveStatusLabel}
                    </span>
                    {closeButton}
                  </header>
                ) : null}
                {/* A note shows its date in the sidebar's top line, which
                    describes the dialog itself, so it is never read twice. */}
                {showTitle ? (
                  <DialogDescription className="sr-only">
                    {addedLabel}
                  </DialogDescription>
                ) : null}

                <div
                  className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto md:flex-row"
                  ref={stage.scrollerRef}
                >
                  <div className="relative flex min-w-0 flex-col md:min-h-0 md:flex-1">
                    <main
                      aria-label={t("header.contentLabel", { type: card.type })}
                      className={cn(
                        "relative min-w-0 md:min-h-0 md:flex-1 md:overflow-y-auto",
                        card.type === "image" && "bg-muted/40",
                        card.type === "video" && "bg-black"
                      )}
                      ref={stage.mainRef}
                    >
                      {stage.available ? (
                        <div className="sticky top-0 z-10 flex justify-center bg-background/80 px-5 py-2 backdrop-blur md:px-10">
                          <ShortcutTooltip
                            keys={["R"]}
                            label={t("reader.toggleTooltip")}
                          >
                            <ToggleGroup
                              aria-keyshortcuts="R"
                              aria-label={t("reader.viewLabel")}
                              onValueChange={(next) => {
                                if (next === "preview" || next === "read") {
                                  stage.setView(next);
                                }
                              }}
                              size="sm"
                              type="single"
                              value={stage.view}
                              variant="outline"
                            >
                              <ToggleGroupItem
                                className={STAGE_VIEW_ITEM_CLASS}
                                value="preview"
                              >
                                {t("reader.preview")}
                              </ToggleGroupItem>
                              <ToggleGroupItem
                                className={STAGE_VIEW_ITEM_CLASS}
                                value="read"
                              >
                                {t("reader.read")}
                              </ToggleGroupItem>
                            </ToggleGroup>
                          </ShortcutTooltip>
                        </div>
                      ) : null}
                      {stage.view === "read" ? (
                        <div className={READ_STAGE_CLASS}>
                          <ArticleReader
                            card={card}
                            highlightControlsRef={readerControls}
                            highlightJump={
                              highlightJump?.id &&
                              highlights?.highlights?.some(
                                (item) => item._id === highlightJump.id
                              )
                                ? highlightJump
                                : null
                            }
                            highlights={isDeleted ? undefined : highlights}
                            key={card._id}
                            onRetry={isDeleted ? undefined : onReprocess}
                            retrying={isReprocessing}
                            title={heading.title}
                          />
                        </div>
                      ) : (
                        <div className={stageContentClass(card)}>
                          <CardPreview
                            card={card}
                            cardLinks={guardedCardLinks}
                            getCurrentValue={getCurrentValue}
                            key={card._id}
                            paletteColors={paletteColors}
                            saveChanges={() => {
                              void saveChanges();
                            }}
                            thumbnail={linkThumbnail}
                            updateContent={editContent}
                          />
                        </div>
                      )}
                    </main>
                  </div>

                  <aside
                    aria-label={t("header.detailsLabel")}
                    className="shrink-0 border-border/60 max-md:border-t md:w-72 md:overflow-y-auto md:border-l lg:w-80 xl:w-[21rem]"
                    ref={asideRef}
                  >
                    {pinnedActions}
                    <div className="space-y-4 border-border/60 border-b px-5 pt-5 pb-5">
                      {sidebarTitle}
                      {trashBlock}
                      {actionBlock}
                    </div>
                    <CardMetadataPanel
                      addedInHeader={!showTitle}
                      backlinks={backlinks}
                      card={card}
                      getCurrentValue={getCurrentValue}
                      highlights={
                        highlights?.highlights
                          ? {
                              items: highlights.highlights,
                              onJump: stage.available
                                ? jumpToHighlight
                                : undefined,
                              onRemove: (highlight) => {
                                void highlights.remove(highlight);
                              },
                            }
                          : undefined
                      }
                      image={
                        imageControl
                          ? {
                              busy: imageControl.isBusy,
                              onReplace: () => imageInputRef.current?.click(),
                              onReset: card.thumbnailOverride
                                ? imageControl.reset
                                : undefined,
                            }
                          : undefined
                      }
                      notesRef={notesRef}
                      onCommit={commit}
                      onEditLink={
                        card.type === "link" && card.url && !isDeleted
                          ? () => setIsEditLinkOpen(true)
                          : undefined
                      }
                      onNotesChange={editNotes}
                      onOpenCard={openLinkedCard}
                      onOpenFolders={
                        isDeleted ? undefined : () => setIsFoldersOpen(true)
                      }
                      onTagClick={onTagClick}
                      tags={{ ...tags, inputRef: tagInputRef }}
                    />
                  </aside>
                </div>

                {isMobile ? (
                  <nav
                    aria-label={t("header.actionsLabel")}
                    className="flex shrink-0 items-center gap-1 border-t bg-background px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                  >
                    {onPrevious || onNext ? (
                      <>
                        <HeaderIconButton
                          disabled={!onPrevious}
                          label={t("header.previousCard")}
                          onClick={() => step(-1)}
                        >
                          <ChevronLeft />
                        </HeaderIconButton>
                        <HeaderIconButton
                          disabled={!onNext}
                          label={t("header.nextCard")}
                          onClick={() => step(1)}
                        >
                          <ChevronRight />
                        </HeaderIconButton>
                      </>
                    ) : null}
                    <span className="flex-1" />
                    {isDeleted ? null : (
                      <HeaderIconButton
                        label={favoriteLabel}
                        onClick={toggleFavorite}
                        pressed={Boolean(card.isFavorited)}
                      >
                        <Heart
                          className={cn(
                            card.isFavorited &&
                              "fill-destructive text-destructive"
                          )}
                        />
                      </HeaderIconButton>
                    )}
                    {renderMenu(
                      <HeaderIconButton label={moreLabel}>
                        <Ellipsis />
                      </HeaderIconButton>
                    )}
                    {primaryButton("compact")}
                  </nav>
                ) : null}
              </div>
              {/* After the card, so Tab reaches the card's own controls first. */}
              {isMobile ? null : (
                <>
                  {onPrevious || onNext ? (
                    <>
                      {navButton("previous")}
                      {navButton("next")}
                    </>
                  ) : null}
                  {closeButton}
                </>
              )}
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">
                {t("header.loadingTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("header.loadingDescription")}
              </DialogDescription>
              <CardModalSkeleton />
            </>
          )}
        </DialogContent>
      </Dialog>

      {card ? (
        <CardFoldersDialog
          cardId={card._id}
          folderIds={(card.folderIds ?? []) as string[]}
          onOpenChange={setIsFoldersOpen}
          open={isFoldersOpen}
        />
      ) : null}

      {card?.type === "link" && card.url ? (
        <EditLinkDialog
          card={{ id: card._id, url: card.url }}
          onOpenChange={setIsEditLinkOpen}
          open={isEditLinkOpen}
        />
      ) : null}

      <ConfirmDialog
        confirmLabel={tDialog("confirm")}
        description={tDialog("description")}
        onConfirm={() => {
          void handlePermanentDelete(closeAfterAction);
        }}
        onOpenChange={setIsPermanentDeleteConfirmOpen}
        open={isPermanentDeleteConfirmOpen}
        title={tDialog("title")}
      />
    </>
  );
}

async function copyToClipboard(text: string, message: string, failed: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error(failed);
  }
}
