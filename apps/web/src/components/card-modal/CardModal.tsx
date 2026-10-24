import { opensOnRead } from "@teak/convex/shared/article";
import { cardLinkTokensToText } from "@teak/convex/shared/cardLinks";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ImageUp,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash,
  Undo2,
  X,
} from "vadivam-react";
import { ArticleReader, articleReaderState } from "@/components/card-previews";
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
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import type { CardSaveState } from "../../hooks/useCardModal";
import { useIsMobile } from "../../hooks/useIsMobile";
import { CARD_DIALOG_ATTRIBUTE } from "../../hooks/useKeyboardShortcuts";
import type { LinkThumbnailControl } from "../../hooks/useLinkThumbnail";
import { useRetainedWhileClosing } from "../../hooks/useRetainedWhileClosing";
import { useStableHandlers } from "../../hooks/useStableHandlers";
import { useStoredFlag } from "../../hooks/useStoredFlag";
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
import { PalettePreview } from "../card-previews/PalettePreview";
import { QuotePreview } from "../card-previews/QuotePreview";
import { TextPreview } from "../card-previews/TextPreview";
import { VideoPreview } from "../card-previews/VideoPreview";
import { getDisplayHostname } from "../cards/cardDisplay";
import { cardTypeLabel } from "../cards/cardTypeLabel";
import { SiteFavicon } from "../cards/SiteFavicon";
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
import { CheckedLinkPreview } from "./CheckedLinkPreview";
import { formatAddedDate, getCardHeading } from "./cardHeading";
import {
  CARD_MODAL_OVERLAY_CLASS,
  CARD_MODAL_SURFACE_CLASS,
  cardModalFrameClass,
  GUTTER_CLOSE_STYLE,
  gutterNavStyle,
  isFullBleedType,
} from "./cardModalFrame";
import { cardModalKeyAction } from "./cardModalKeys";
import { emptiedContentNotice, saveStateLabel } from "./cardModalText";
import { HeaderIconButton } from "./HeaderIconButton";
import type { CardModalCard, GetCurrentValue } from "./types";
import { useCardSteps } from "./useCardSteps";
import { EMPTY_CONTENT_TOAST_ID, useLeaveGuard } from "./useLeaveGuard";
import { useSaveStatus } from "./useSaveStatus";

export const AUTOSAVE_DELAY_MS = 800;

// Tests and callers read it from here, beside the dialog.
export { emptiedContentNotice } from "./cardModalText";

export const DETAILS_HIDDEN_KEY = "teak.cardModal.detailsHidden";

function CardPreview({
  card,
  cardLinks,
  getCurrentValue,
  saveChanges,
  thumbnail,
  updateContent,
}: {
  card: CardModalCard;
  cardLinks?: CardLinkOptions;
  getCurrentValue: GetCurrentValue;
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
      // Only a link with an archived copy is ever checked.
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
      return <PalettePreview card={card} />;
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
      return "px-5 pt-2 pb-6 md:px-10 md:pb-10";
    case "text":
      return "mx-auto w-full max-w-3xl px-5 pb-6 md:px-10 md:pb-12";
    default:
      return "flex min-h-full items-center justify-center p-5 md:p-10";
  }
}

/** The Read tab's stage: the reader sets its own 68ch column inside it. */
const READ_STAGE_CLASS = "px-5 py-8 md:px-10 md:py-12";

type StageView = "preview" | "read";

/**
 * Preview or Read for a link with an article (or one on its way): the
 * category's default until someone picks, and only for this card, so a pick
 * never carries over to the next one. The scroll of each view is kept per
 * card while the dialog is open.
 */
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

/** The header's one main action, in ink rather than the brand color. */
const PRIMARY_ACTION_CLASS =
  "h-8 rounded-full bg-foreground px-3.5 text-background hover:bg-foreground/85";

/** Single-letter keys the dialog answers, shown beside their menu items. */
const DIALOG_KEYS = {
  copy: { keys: "C", label: "C" },
  details: { keys: "I", label: "I" },
  done: { keys: "D", label: "D" },
  favorite: { keys: "F", label: "F" },
} as const;

interface CardModalProps {
  backlinks?: CardBacklinks;
  card?: CardModalCard | null;
  cardId?: string | null;
  /** `[[` links in a note: card search, live titles and opening a card. */
  cardLinks?: CardLinkOptions;
  downloadFile: () => void;
  getCurrentValue: GetCurrentValue;
  handleDelete: (onClose?: () => void) => Promise<void>;
  handlePermanentDelete: (onClose?: () => void) => Promise<void>;
  handleRestore: (onClose?: () => void) => Promise<void>;
  hasUnsavedChanges: boolean;
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
  openLink,
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
  const dateLocale = useIntlLocale(US_ENGLISH_LOCALE);
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] =
    useState(false);
  const [isFoldersOpen, setIsFoldersOpen] = useState(false);
  const card = useRetainedWhileClosing(cardProp, open);
  const contentRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [isDetailsHidden, setIsDetailsHidden] =
    useStoredFlag(DETAILS_HIDDEN_KEY);
  // Phones always stack the details under the card.
  const detailsHidden = isDetailsHidden && !isMobile;
  const pendingFocus = useRef<"notes" | "tags" | null>(null);
  const saveStatus = useSaveStatus(saveState);
  const stage = useStageView(card, open);

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

  // N and T reopen hidden details, then focus their field.
  useEffect(() => {
    if (detailsHidden || !pendingFocus.current) {
      return;
    }
    const target = pendingFocus.current;
    pendingFocus.current = null;
    (target === "notes" ? notesRef : tagInputRef).current?.focus();
  }, [detailsHidden]);

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

  /** `keepsCard`: the action leaves the card in place, like Archive. */
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
  // `[[` links copy as their titles, not the stored `[[Title|teak:id]]`.
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

  /** The one main action: open a link, or download a file. */
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
    if (detailsHidden) {
      pendingFocus.current = field;
      setIsDetailsHidden(false);
      return;
    }
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

  const asideRef = useRef<HTMLElement>(null);
  const toggleDetails = () => {
    // Hiding the panel would hide a focused control in it, dropping focus
    // out of the dialog and with it every card key.
    if (!detailsHidden && asideRef.current?.contains(document.activeElement)) {
      contentRef.current?.focus();
    }
    setIsDetailsHidden((hidden) => !hidden);
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
      case "toggleDetails":
        if (!isMobile) {
          toggleDetails();
        }
        break;
      case "toggleReader":
        if (stage.available) {
          stage.toggle();
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
  const editedTitle = getCurrentValue("metadataTitle");
  const titleValue =
    card && editedTitle !== card.metadataTitle
      ? (editedTitle ?? "")
      : (heading?.title ?? "");
  const fullBleed = !isMobile && isFullBleedType(card?.type);
  // "Note", "Quote" and "Palette" say nothing the card doesn't, so the
  // content is the heading.
  const showTitle = Boolean(
    heading &&
      (heading.editable || heading.title !== typeLabel) &&
      !(card?.type === "text" || card?.type === "quote")
  );

  let primaryButton: ReactNode = null;
  if (card?.url && !isDeleted) {
    primaryButton = (
      <ShortcutTooltip keys={["O"]} label={t("header.openTooltip")}>
        <Button
          aria-keyshortcuts="O"
          className={PRIMARY_ACTION_CLASS}
          onClick={openLink}
          size="sm"
        >
          {t("header.open")}
          <ArrowUpRight />
        </Button>
      </ShortcutTooltip>
    );
  } else if (canDownload && !card?.url) {
    primaryButton = (
      <ShortcutTooltip keys={["O"]} label={t("header.downloadTooltip")}>
        <Button
          aria-busy={isDownloading}
          aria-keyshortcuts="O"
          className={PRIMARY_ACTION_CLASS}
          disabled={isDownloading}
          onClick={downloadFile}
          size="sm"
        >
          {isDownloading ? <Spinner /> : <Download />}
          {isDownloading ? t("header.downloading") : t("header.download")}
        </Button>
      </ShortcutTooltip>
    );
  }

  const favoriteButton =
    card && !isDeleted ? (
      <HeaderIconButton
        label={card.isFavorited ? t("menu.unfavorite") : t("menu.favorite")}
        onClick={toggleFavorite}
        pressed={Boolean(card.isFavorited)}
        shortcut={["F"]}
      >
        <Heart
          className={cn(
            card.isFavorited && "fill-destructive text-destructive"
          )}
        />
      </HeaderIconButton>
    ) : null;

  const menu = card ? (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton label={t("menu.moreActions")}>
          <Ellipsis />
        </HeaderIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        onCloseAutoFocus={onMenuCloseAutoFocus}
      >
        {isDeleted ? null : (
          <DropdownMenuGroup>
            <DropdownMenuItem
              aria-keyshortcuts={DIALOG_KEYS.favorite.keys}
              onClick={toggleFavorite}
            >
              <Heart />
              {card.isFavorited ? t("menu.unfavorite") : t("menu.favorite")}
              <DropdownMenuShortcut aria-hidden>
                {DIALOG_KEYS.favorite.label}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            {canToggleDone ? (
              <DropdownMenuItem
                aria-keyshortcuts={DIALOG_KEYS.done.keys}
                onClick={toggleDone}
              >
                {isDone ? <CircleCheck /> : <Circle />}
                {doneMenuLabel}
                <DropdownMenuShortcut aria-hidden>
                  {DIALOG_KEYS.done.label}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={openFoldersFromMenu}>
              <FolderPlus />
              {t("menu.addToFolder")}
            </DropdownMenuItem>
            {toggleArchive ? (
              <DropdownMenuItem
                aria-keyshortcuts={menuShortcuts.archive.keys}
                onClick={archive}
              >
                {card.isArchived ? <ArchiveRestore /> : <Archive />}
                {card.isArchived ? t("menu.unarchive") : t("menu.archive")}
                <DropdownMenuShortcut aria-hidden>
                  {menuShortcuts.archive.label}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        )}
        {card.url || copyableText ? (
          <>
            {isDeleted ? null : <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {card.url ? (
                <DropdownMenuItem
                  aria-keyshortcuts={DIALOG_KEYS.copy.keys}
                  onClick={() =>
                    void copyToClipboard(
                      card.url as string,
                      t("toasts.copiedLink"),
                      copyFailed
                    )
                  }
                >
                  <Copy />
                  {t("menu.copyLink")}
                  <DropdownMenuShortcut aria-hidden>
                    {DIALOG_KEYS.copy.label}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
              ) : null}
              {copyableText ? (
                <DropdownMenuItem
                  aria-keyshortcuts={
                    card.url ? undefined : DIALOG_KEYS.copy.keys
                  }
                  onClick={() =>
                    void copyToClipboard(
                      copyableText,
                      t("toasts.copiedText"),
                      copyFailed
                    )
                  }
                >
                  <Copy />
                  {t("menu.copyText")}
                  {card.url ? null : (
                    <DropdownMenuShortcut aria-hidden>
                      {DIALOG_KEYS.copy.label}
                    </DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
        {(canDownload && card.url) ||
        (savePdf && !isDeleted) ||
        imageControl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {canDownload && card.url ? (
                <DropdownMenuItem
                  disabled={isDownloading}
                  onClick={downloadFile}
                >
                  <Download />
                  {t("menu.download")}
                </DropdownMenuItem>
              ) : null}
              {savePdf && !isDeleted ? (
                <DropdownMenuItem
                  aria-busy={savePdf.isSaving}
                  disabled={savePdf.isSaving}
                  onClick={savePdf.save}
                >
                  {savePdf.isSaving ? <Spinner /> : <FileDown />}
                  {savePdf.isSaving ? t("menu.savingPdf") : t("menu.savePdf")}
                </DropdownMenuItem>
              ) : null}
              {imageControl ? (
                <DropdownMenuItem
                  disabled={imageControl.isBusy}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {imageControl.isBusy ? <Spinner /> : <ImageUp />}
                  {t("menu.replaceImage")}
                </DropdownMenuItem>
              ) : null}
              {imageControl && card.thumbnailOverride ? (
                <DropdownMenuItem
                  disabled={imageControl.isBusy}
                  onClick={imageControl.reset}
                >
                  <Undo2 />
                  {t("menu.resetImage")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
        {!isDeleted && (onMoreLikeThis || onReprocess) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {onMoreLikeThis ? (
                <DropdownMenuItem onClick={() => onMoreLikeThis(card._id)}>
                  <Sparkles />
                  {t("menu.moreLikeThis")}
                </DropdownMenuItem>
              ) : null}
              {onReprocess ? (
                <DropdownMenuItem
                  disabled={isReprocessing}
                  onClick={onReprocess}
                >
                  {isReprocessing ? <Spinner /> : <RefreshCw />}
                  {t("menu.refreshDetails")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
        {isMobile ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              aria-keyshortcuts={DIALOG_KEYS.details.keys}
              onClick={toggleDetails}
            >
              {detailsHidden ? <PanelRightOpen /> : <PanelRightClose />}
              {detailsHidden ? t("menu.showDetails") : t("menu.hideDetails")}
              <DropdownMenuShortcut aria-hidden>
                {DIALOG_KEYS.details.label}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {isDeleted ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              aria-keyshortcuts={menuShortcuts.delete.keys}
              onClick={() => void handleDelete(closeAfterAction)}
              variant="destructive"
            >
              <Trash />
              {tc("delete")}
              <DropdownMenuShortcut aria-hidden>
                {menuShortcuts.delete.label}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {isMobile ? null : (
          <DropdownMenuLabel className="border-t pt-2 font-normal text-muted-foreground text-xs">
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

  const header =
    card && heading ? (
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 pr-2 pl-4 md:pr-3 md:pl-5",
          isMobile && "border-b",
          fullBleed &&
            "absolute inset-x-0 top-0 z-20 bg-background/85 opacity-0 pointer-coarse:opacity-100 shadow-sm backdrop-blur-md transition-opacity duration-150 focus-within:opacity-100 group-hover/stage:opacity-100"
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {hostname && showTitle ? (
            <SiteFavicon className="size-4" hostname={hostname} />
          ) : null}
          {heading.editable && !isDeleted ? (
            <div className="group/title relative min-w-0 flex-1">
              <DialogTitle className="sr-only">{heading.title}</DialogTitle>
              <input
                aria-label={t("header.titleLabel")}
                className="-mx-1.5 block w-[calc(100%+0.75rem)] truncate rounded-md bg-transparent py-0.5 pr-7 pl-1.5 font-medium text-sm outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted/70"
                dir="auto"
                maxLength={512}
                onBlur={(event) => {
                  if (event.target.value.trim()) {
                    commit();
                  } else {
                    editTitle(undefined);
                  }
                }}
                onChange={(event) => editTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                placeholder={t("header.titlePlaceholder")}
                value={titleValue}
              />
              <Pencil
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-has-[input:focus]/title:opacity-0"
              />
            </div>
          ) : (
            <DialogTitle
              className={cn(
                "min-w-0 flex-1 truncate font-medium text-sm leading-6",
                !showTitle && "sr-only"
              )}
              dir="auto"
              title={heading.title}
            >
              {heading.title}
            </DialogTitle>
          )}
          <DialogDescription className="sr-only">
            {formatAddedDate(card.createdAt, undefined, {
              locale: dateLocale,
              t: tHeading,
            })}
          </DialogDescription>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {saveStatus ? (
            <span
              className={cn(
                "whitespace-nowrap px-1 text-muted-foreground text-xs",
                saveStatus === "error" && "text-destructive"
              )}
            >
              {saveStateLabel(saveStatus, t, tc)}
            </span>
          ) : null}
          {isMobile ? null : (
            <>
              {favoriteButton}
              {menu}
              {primaryButton ? (
                <span className="ml-1">{primaryButton}</span>
              ) : null}
            </>
          )}
          {isMobile ? closeButton : null}
        </div>
      </header>
    ) : null;

  const mobileHeader = isMobile ? header : null;
  const desktopHeader = isMobile ? null : header;

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
                {isDeleted ? (
                  <div
                    className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/60 py-1.5 pr-1.5 pl-4"
                    role="status"
                  >
                    <p className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Trash aria-hidden="true" className="size-3.5" />
                      {t("trash.inTrash")}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        className="h-7 px-2.5"
                        onClick={() => void handleRestore(closeAfterAction)}
                        size="sm"
                        variant="ghost"
                      >
                        <RotateCcw />
                        {t("trash.restore")}
                      </Button>
                      <Button
                        className="h-7 px-2.5 text-destructive hover:text-destructive"
                        onClick={() => setIsPermanentDeleteConfirmOpen(true)}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash />
                        {t("trash.deleteForever")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {mobileHeader}

                <div
                  className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto md:flex-row"
                  ref={stage.scrollerRef}
                >
                  <div className="group/stage relative flex min-w-0 flex-col md:min-h-0 md:flex-1">
                    {desktopHeader}
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
                              <ToggleGroupItem className="px-3" value="preview">
                                {t("reader.preview")}
                              </ToggleGroupItem>
                              <ToggleGroupItem className="px-3" value="read">
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
                    className={cn(
                      "shrink-0 border-border/60 max-md:border-t md:w-72 md:overflow-y-auto md:border-l lg:w-80 xl:w-[21rem]",
                      detailsHidden && "md:hidden"
                    )}
                    ref={asideRef}
                  >
                    <CardMetadataPanel
                      backlinks={backlinks}
                      card={card}
                      done={
                        canToggleDone && toggleDone
                          ? {
                              category: card.metadata?.linkCategory?.category,
                              done: isDone,
                              onToggle: toggleDone,
                            }
                          : undefined
                      }
                      getCurrentValue={getCurrentValue}
                      notesRef={notesRef}
                      onCardTypeClick={() => onCardTypeClick?.(card.type)}
                      onCommit={commit}
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
                    {favoriteButton}
                    {menu}
                    {primaryButton}
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
