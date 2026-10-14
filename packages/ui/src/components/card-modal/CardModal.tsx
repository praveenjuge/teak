import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import { Spinner } from "@teak/ui/components/ui/spinner";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash,
  Trash2,
  X,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { CardSaveState } from "../../hooks/useCardModal";
import { readCardOpenOrigin } from "../../lib/cardOpenOrigin";
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
import { SiteFavicon } from "../cards/SiteFavicon";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CardMetadataPanel, type CardTagsControl } from "./CardMetadataPanel";
import { formatAddedDate, getCardHeading } from "./cardHeading";
import { cardModalKeyAction } from "./cardModalKeys";
import { getCardTypeIconComponent } from "./cardTypeIcon";
import type { CardModalCard, GetCurrentValue } from "./types";

/** How long typing pauses before an edit saves on its own. */
export const AUTOSAVE_DELAY_MS = 800;

type Stage = "media" | "reading" | "compact";

/** How much room a card's content needs: media fills the dialog. */
function stageFor(type?: string): Stage {
  if (
    type === "image" ||
    type === "video" ||
    type === "document" ||
    type === "link"
  ) {
    return "media";
  }
  if (type === "text") {
    return "reading";
  }
  return "compact";
}

function CardPreview({
  card,
  getCurrentValue,
  saveChanges,
  updateContent,
}: {
  card: CardModalCard;
  getCurrentValue: GetCurrentValue;
  saveChanges: () => void;
  updateContent: (value: string) => void;
}) {
  switch (card.type) {
    case "text":
      return (
        <TextPreview
          card={card}
          getCurrentValue={getCurrentValue}
          onContentChange={updateContent}
          onSaveShortcut={saveChanges}
        />
      );
    case "quote":
      return (
        <QuotePreview
          card={card}
          getCurrentValue={getCurrentValue}
          onContentChange={updateContent}
        />
      );
    case "link":
      return <LinkPreview card={card} showScreenshot />;
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

/** Where the stage pads and centres each kind of content. */
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
      return "px-5 py-6 md:px-10 md:py-10";
    case "text":
      return "mx-auto w-full max-w-2xl px-5 py-6 md:px-8 md:py-10";
    default:
      return "flex min-h-full items-center justify-center p-5 md:p-10";
  }
}

const SAVE_STATE_LABELS: Record<CardSaveState, string> = {
  idle: "",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

interface CardModalProps {
  card?: CardModalCard | null;
  /** The card being opened, before its data arrives. */
  cardId?: string | null;
  downloadFile: () => void;
  getCurrentValue: GetCurrentValue;
  handleDelete: (onClose?: () => void) => Promise<void>;
  handlePermanentDelete: (onClose?: () => void) => Promise<void>;
  handleRestore: (onClose?: () => void) => Promise<void>;
  hasUnsavedChanges: boolean;
  isDownloading?: boolean;
  isReprocessing?: boolean;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  /** Shows the next card in the grid; absent on the last card. */
  onNext?: () => void;
  /** Shows the previous card in the grid; absent on the first card. */
  onPrevious?: () => void;
  onReprocess?: () => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
  openLink: () => void;
  saveChanges: (options?: { silent?: boolean }) => Promise<boolean>;
  saveState: CardSaveState;
  tags: Omit<CardTagsControl, "inputRef">;
  /** Archives or unarchives the card; the dialog then closes. */
  toggleArchive?: () => void;
  toggleFavorite: () => void;
  updateContent: (value: string) => void;
  updateNotes: (value: string) => void;
  updateTitle: (value: string | undefined) => void;
}

export function CardModal({
  card,
  cardId,
  open,
  onCancel,
  onCardTypeClick,
  onNext,
  onPrevious,
  onTagClick,
  hasUnsavedChanges,
  getCurrentValue,
  updateContent,
  updateNotes,
  updateTitle,
  toggleArchive,
  toggleFavorite,
  handleDelete,
  handleRestore,
  handlePermanentDelete,
  openLink,
  downloadFile,
  saveChanges,
  saveState,
  tags,
  isDownloading,
  isReprocessing,
  onReprocess,
}: CardModalProps) {
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] =
    useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // The dialog grows out of the card it was opened from, when it knows it.
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

  // Edits save themselves once typing pauses.
  useEffect(() => {
    if (!(open && hasUnsavedChanges)) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveChanges({ silent: true });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, hasUnsavedChanges, saveChanges]);

  const commit = () => {
    if (hasUnsavedChanges) {
      void saveChanges({ silent: true });
    }
  };

  // Closing or moving to another card saves first; if that fails, the card
  // stays open so the edit isn't lost and can be saved again.
  const handleClose = async () => {
    if (hasUnsavedChanges && !(await saveChanges({ silent: true }))) {
      return;
    }
    onCancel?.();
  };

  // Delete, archive and restore take the card out of this view, so the
  // dialog closes after them even if a last save fails.
  const closeAfterAction = async () => {
    if (hasUnsavedChanges) {
      await saveChanges({ silent: true });
    }
    onCancel?.();
  };

  const goTo = async (show?: () => void) => {
    if (!show) {
      return;
    }
    if (hasUnsavedChanges && !(await saveChanges({ silent: true }))) {
      return;
    }
    show();
  };

  const isDeleted = Boolean(card?.isDeleted);
  const canDownload = Boolean(
    card?.fileKey && ["document", "audio", "video", "image"].includes(card.type)
  );
  const copyableText =
    card?.type === "text" || card?.type === "quote"
      ? (getCurrentValue("content") ?? "")
      : "";

  const archive = () => {
    if (toggleArchive && !isDeleted) {
      toggleArchive();
      void closeAfterAction();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      !card ||
      // Keys from a menu or dialog opened on top belong to it.
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
        void goTo(onPrevious);
        break;
      case "next":
        void goTo(onNext);
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
        tagInputRef.current?.focus();
        break;
      case "focusNotes":
        notesRef.current?.focus();
        break;
      default:
        break;
    }
  };

  const stage = stageFor(card?.type);
  const heading = card ? getCardHeading(card) : null;
  const TypeIcon = getCardTypeIconComponent(card?.type as CardType);
  const hostname =
    card?.type === "link" ? getDisplayHostname(card.url) : undefined;
  const typeLabel = card
    ? (CARD_TYPE_LABELS[card.type as CardType] ?? "Card")
    : "Card";
  // The title field shows the resolved title until someone edits it.
  const editedTitle = getCurrentValue("metadataTitle");
  const titleValue =
    card && editedTitle !== card.metadataTitle
      ? (editedTitle ?? "")
      : (heading?.title ?? "");

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
          className={cn(
            "flex flex-col gap-0 overflow-hidden border bg-background p-0 shadow-2xl outline-none sm:max-w-none",
            // Phones: a sheet from the bottom that scrolls as one page.
            "max-md:data-[state=closed]:slide-out-to-bottom max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:zoom-in-100 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:h-[94dvh] max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0",
            stage === "media" &&
              "md:h-[min(56rem,calc(100dvh-4rem))] md:w-[min(82rem,calc(100vw-4rem))]",
            stage === "reading" &&
              "md:h-[min(52rem,calc(100dvh-4rem))] md:w-[min(70rem,calc(100vw-4rem))]",
            stage === "compact" &&
              "md:h-[min(40rem,calc(100dvh-4rem))] md:w-[min(64rem,calc(100vw-4rem))]",
            openOrigin &&
              "md:data-[state=open]:zoom-in-[0.55] md:data-[state=open]:duration-300 md:data-[state=open]:ease-out"
          )}
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(event) => {
            // Focus the dialog itself, not its first field, so its keys
            // work at once and nothing starts in edit mode.
            event.preventDefault();
            contentRef.current?.focus();
          }}
          ref={contentRef}
          showCloseButton={false}
          style={openOrigin ? { transformOrigin: openOrigin } : undefined}
        >
          {card && heading ? (
            <>
              <header className="flex h-14 shrink-0 items-center gap-2 border-b pr-2 pl-3 md:gap-3 md:pr-3 md:pl-4">
                <div
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  {hostname ? (
                    <SiteFavicon className="size-4" hostname={hostname} />
                  ) : (
                    <TypeIcon className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {heading.editable && !isDeleted ? (
                    <>
                      <DialogTitle className="sr-only">
                        {heading.title}
                      </DialogTitle>
                      <input
                        aria-label="Title"
                        className="-mx-1.5 block w-[calc(100%+0.75rem)] truncate rounded-md bg-transparent px-1.5 py-0.5 font-medium text-sm outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted/70"
                        dir="auto"
                        maxLength={512}
                        onBlur={(event) => {
                          // Leaving the title blank keeps the one it had.
                          if (event.target.value.trim()) {
                            commit();
                          } else {
                            updateTitle(undefined);
                          }
                        }}
                        onChange={(event) => updateTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        placeholder="Untitled link"
                        value={titleValue}
                      />
                    </>
                  ) : (
                    <DialogTitle
                      className="truncate font-medium text-sm leading-6"
                      dir="auto"
                      title={heading.title}
                    >
                      {heading.title}
                    </DialogTitle>
                  )}
                  <DialogDescription className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground text-xs">
                    {hostname && (
                      <span className="truncate max-sm:hidden">{hostname}</span>
                    )}
                    {hostname && (
                      <span aria-hidden="true" className="max-sm:hidden">
                        ·
                      </span>
                    )}
                    <span className="shrink-0">
                      {formatAddedDate(card.createdAt)}
                    </span>
                    {saveState !== "idle" && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          aria-live="polite"
                          className={cn(
                            "shrink-0",
                            saveState === "error" && "text-destructive"
                          )}
                        >
                          {SAVE_STATE_LABELS[saveState]}
                        </span>
                      </>
                    )}
                  </DialogDescription>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  {(onPrevious || onNext) && (
                    <div className="mr-1 flex items-center gap-0.5 md:mr-2">
                      <HeaderIconButton
                        disabled={!onPrevious}
                        label="Previous card"
                        onClick={() => void goTo(onPrevious)}
                        shortcut="←"
                      >
                        <ChevronLeft />
                      </HeaderIconButton>
                      <HeaderIconButton
                        disabled={!onNext}
                        label="Next card"
                        onClick={() => void goTo(onNext)}
                        shortcut="→"
                      >
                        <ChevronRight />
                      </HeaderIconButton>
                    </div>
                  )}

                  {!isDeleted && (
                    <HeaderIconButton
                      label={card.isFavorited ? "Unfavorite" : "Favorite"}
                      onClick={toggleFavorite}
                      pressed={Boolean(card.isFavorited)}
                      shortcut="F"
                    >
                      <Heart
                        className={cn(
                          card.isFavorited &&
                            "fill-destructive text-destructive"
                        )}
                      />
                    </HeaderIconButton>
                  )}

                  {card.url && !isDeleted && (
                    <Button
                      className="mx-1 h-8 rounded-full px-3 max-sm:w-8 max-sm:px-0"
                      onClick={openLink}
                      size="sm"
                      variant="outline"
                    >
                      <ArrowUpRight />
                      <span className="max-sm:sr-only">Open</span>
                    </Button>
                  )}
                  {canDownload && !card.url && (
                    <Button
                      className="mx-1 h-8 rounded-full px-3 max-sm:w-8 max-sm:px-0"
                      disabled={isDownloading}
                      onClick={downloadFile}
                      size="sm"
                      variant="outline"
                    >
                      {isDownloading ? <Spinner /> : <Download />}
                      <span className="max-sm:sr-only">
                        {isDownloading ? "Downloading…" : "Download"}
                      </span>
                    </Button>
                  )}

                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <HeaderIconButton label="More actions">
                        <MoreHorizontal />
                      </HeaderIconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {card.url && (
                        <DropdownMenuItem
                          onClick={() =>
                            void copyToClipboard(
                              card.url as string,
                              "Copied link"
                            )
                          }
                        >
                          <Copy />
                          Copy Link
                        </DropdownMenuItem>
                      )}
                      {copyableText && (
                        <DropdownMenuItem
                          onClick={() =>
                            void copyToClipboard(copyableText, "Copied text")
                          }
                        >
                          <Copy />
                          Copy Text
                        </DropdownMenuItem>
                      )}
                      {canDownload && card.url && (
                        <DropdownMenuItem
                          disabled={isDownloading}
                          onClick={downloadFile}
                        >
                          <Download />
                          Download
                        </DropdownMenuItem>
                      )}
                      {isDeleted ? (
                        <>
                          <DropdownMenuItem
                            onClick={() => void handleRestore(closeAfterAction)}
                          >
                            <RotateCcw />
                            Restore
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              setIsPermanentDeleteConfirmOpen(true)
                            }
                            variant="destructive"
                          >
                            <Trash />
                            Delete Forever
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          {onReprocess && (
                            <DropdownMenuItem
                              disabled={isReprocessing}
                              onClick={onReprocess}
                            >
                              {isReprocessing ? <Spinner /> : <RefreshCw />}
                              Refresh details
                            </DropdownMenuItem>
                          )}
                          {toggleArchive && (
                            <DropdownMenuItem onClick={archive}>
                              {card.isArchived ? (
                                <ArchiveRestore />
                              ) : (
                                <Archive />
                              )}
                              {card.isArchived ? "Unarchive" : "Archive"}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => void handleDelete(closeAfterAction)}
                            variant="destructive"
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DialogClose asChild>
                    <HeaderIconButton label="Close" shortcut="Esc">
                      <X />
                    </HeaderIconButton>
                  </DialogClose>
                </div>
              </header>

              <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto md:flex-row">
                <main
                  aria-label={`${typeLabel} content`}
                  className={cn(
                    "relative min-w-0 md:min-h-0 md:flex-1 md:overflow-y-auto",
                    card.type === "image" && "bg-muted/40",
                    card.type === "video" && "bg-black"
                  )}
                >
                  <div className={stageContentClass(card)}>
                    <CardPreview
                      card={card}
                      getCurrentValue={getCurrentValue}
                      key={card._id}
                      saveChanges={() => {
                        void saveChanges();
                      }}
                      updateContent={updateContent}
                    />
                  </div>
                </main>

                <aside
                  aria-label="Card details"
                  className="shrink-0 border-t bg-muted/25 md:w-80 md:overflow-y-auto md:border-t-0 md:border-l lg:w-[21rem]"
                >
                  <CardMetadataPanel
                    card={card}
                    getCurrentValue={getCurrentValue}
                    notesRef={notesRef}
                    onCardTypeClick={() => onCardTypeClick?.(card.type)}
                    onCommit={commit}
                    onNotesChange={updateNotes}
                    onPermanentDelete={() =>
                      setIsPermanentDeleteConfirmOpen(true)
                    }
                    onRestore={() => void handleRestore(closeAfterAction)}
                    onTagClick={onTagClick}
                    tags={{ ...tags, inputRef: tagInputRef }}
                  />
                </aside>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col">
              <DialogTitle className="sr-only">Loading card</DialogTitle>
              <DialogDescription className="sr-only">
                Loading card details
              </DialogDescription>
              <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
                <div className="size-8 animate-pulse rounded-lg bg-muted" />
                <div className="h-3 w-48 animate-pulse rounded bg-muted" />
              </div>
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        confirmLabel="Delete Forever"
        description="This permanently deletes the card and its files. This can’t be undone."
        onConfirm={() => {
          void handlePermanentDelete(closeAfterAction);
        }}
        onOpenChange={setIsPermanentDeleteConfirmOpen}
        open={isPermanentDeleteConfirmOpen}
        title="Delete this card forever?"
      />
    </>
  );
}

async function copyToClipboard(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Failed to copy");
  }
}

function HeaderIconButton({
  children,
  label,
  pressed,
  shortcut,
  ref,
  ...props
}: React.ComponentProps<"button"> & {
  children: ReactNode;
  label: string;
  pressed?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg]:size-4"
      ref={ref}
      title={shortcut ? `${label} (${shortcut})` : label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
