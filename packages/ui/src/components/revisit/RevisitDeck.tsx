import { api } from "@teak/convex";
import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Kbd } from "@teak/ui/components/ui/kbd";
import { useQuery } from "convex-helpers/react/cache/hooks";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  RevisitCard,
  RevisitDeck as RevisitDeckState,
} from "../../hooks/useRevisitDeck";
import { resolveLinkTitle } from "../../lib/linkTitle";
import { cn } from "../../lib/utils";
import { CardBody } from "../cards/CardBody";
import {
  successfulLinkPreview,
  useLinkCardImage,
} from "../cards/linkCardImage";
import type { CardWithUrls } from "../cards/types";

export const REVISIT_SWIPE_THRESHOLD = 96;

export type RevisitKeyAction = "archive" | "details" | "keep" | "undo";

export function revisitKeyAction(event: {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
}): RevisitKeyAction | null {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }
  switch (event.key) {
    case "ArrowLeft":
    case "a":
    case "A":
      return "archive";
    case "ArrowRight":
    case "k":
    case "K":
      return "keep";
    case " ":
      return "details";
    case "z":
    case "Z":
      return "undo";
    default:
      return null;
  }
}

export function focusRevisitDeck(): boolean {
  const deck = document.querySelector<HTMLElement>("[data-revisit-deck]");
  deck?.focus({ preventScroll: true });
  return deck !== null;
}

const savedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const mediaWidth = (card: CardWithUrls): string | undefined => {
  const isMedia =
    card.type === "image" || card.type === "video" || card.type === "document";
  const width = card.fileMetadata?.width;
  const height = card.fileMetadata?.height;
  if (!(isMedia && width && height)) {
    return undefined;
  }
  return `min(100%, calc(var(--revisit-card-height) * ${width / height}))`;
};

function DeckCard({ card }: { card: CardWithUrls }) {
  const { image, onImageError } = useLinkCardImage(card);
  const title = resolveLinkTitle({
    metadataTitle: card.metadataTitle,
    metadataTitleEdited: card.metadataTitleEdited,
    previewTitle: successfulLinkPreview(card)?.title,
    url: card.url,
  });
  return (
    <div
      className="max-h-(--revisit-card-height) overflow-hidden rounded-2xl bg-card shadow-lg ring-1 ring-border"
      style={{ width: mediaWidth(card) ?? "100%" }}
    >
      <CardBody
        card={card}
        isPriority
        link={{ image, onImageError, title }}
        textInsets=""
      />
    </div>
  );
}

function DeckProgress({
  position,
  total,
}: {
  position: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden="true"
        className="h-1 w-24 overflow-hidden rounded-full bg-muted sm:w-40"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: total > 0 ? `${(position / total) * 100}%` : "0%" }}
        />
      </div>
      <span className="text-muted-foreground text-sm tabular-nums">
        {position} of {total}
      </span>
    </div>
  );
}

interface LeavingCard {
  card: RevisitCard;
  move: "archive" | "keep";
}

export interface RevisitDeckProps {
  deck: RevisitDeckState;
  onExit: () => void;
  onOpenCard: (cardId: string) => void;
  onStartOver: () => void;
  open: boolean;
}

export function RevisitDeck({
  deck,
  onExit,
  onOpenCard,
  onStartOver,
  open,
}: RevisitDeckProps) {
  const snapshot = deck.current;
  const live = useQuery(
    api.cards.getCard,
    snapshot ? { id: snapshot._id } : "skip"
  ) as RevisitCard | null | undefined;
  const card = snapshot && live?._id === snapshot._id ? live : snapshot;

  const contentRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<LeavingCard | null>(null);
  const shown = useRef<RevisitCard | null>(null);
  useEffect(() => {
    const previous = shown.current;
    shown.current = card;
    if (
      previous &&
      card &&
      previous._id !== card._id &&
      (deck.move === "archive" || deck.move === "keep")
    ) {
      setLeaving({ card: previous, move: deck.move });
    } else if (!card || deck.move === "back") {
      setLeaving(null);
    }
  }, [card, deck.move]);

  const [drag, setDrag] = useState<{ dx: number; startX: number } | null>(null);
  const dragged = useRef(false);

  const act = (action: RevisitKeyAction) => {
    if (action === "archive") {
      void deck.archive();
    } else if (action === "keep") {
      deck.keep();
    } else if (action === "undo") {
      void deck.undo();
    } else if (snapshot) {
      onOpenCard(snapshot._id);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = revisitKeyAction(event);
    if (
      !action ||
      deck.status !== "ready" ||
      ((deck.done || deck.total === 0) && action !== "undo")
    ) {
      return;
    }
    event.preventDefault();
    act(action);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || deck.pending) {
      return;
    }
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ dx: 0, startX: event.clientX });
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) {
      return;
    }
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 8) {
      dragged.current = true;
    }
    setDrag({ ...drag, dx });
  };
  const handlePointerUp = () => {
    if (!drag) {
      return;
    }
    const { dx } = drag;
    setDrag(null);
    if (dx <= -REVISIT_SWIPE_THRESHOLD) {
      act("archive");
    } else if (dx >= REVISIT_SWIPE_THRESHOLD) {
      act("keep");
    }
  };

  const dragOffset = drag?.dx ?? 0;
  let swipeHint: "archive" | "keep" | null = null;
  if (dragOffset <= -REVISIT_SWIPE_THRESHOLD) {
    swipeHint = "archive";
  } else if (dragOffset >= REVISIT_SWIPE_THRESHOLD) {
    swipeHint = "keep";
  }

  let enterClass = "motion-safe:slide-in-from-bottom-2";
  if (deck.move === "back") {
    enterClass = "motion-safe:slide-in-from-left-24";
  }

  const renderBody = () => {
    if (deck.status === "loading") {
      return (
        <div
          aria-label="Loading cards"
          className="flex w-full max-w-md flex-col items-center gap-6"
          role="status"
        >
          <div className="h-[min(26rem,var(--revisit-card-height))] w-full animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
        </div>
      );
    }
    if (deck.status === "error") {
      return (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-medium">Couldn't load cards</p>
          <Button onClick={deck.retry} variant="outline">
            <RotateCcw />
            Retry
          </Button>
        </div>
      );
    }
    if (deck.total === 0) {
      return (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-medium">Nothing to revisit here</p>
          <Button onClick={onExit} variant="outline">
            Done
          </Button>
        </div>
      );
    }
    if (deck.done) {
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Check aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="font-semibold text-xl">All caught up</p>
            <p className="text-muted-foreground text-sm">
              {deck.archived} archived · {deck.kept} kept
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              autoFocus
              onClick={deck.exhausted ? onStartOver : deck.more}
            >
              {deck.exhausted ? "Start over" : "Revisit 20 more"}
            </Button>
            <Button onClick={onExit} variant="outline">
              Done
            </Button>
          </div>
          {deck.canUndo && (
            <p className="text-muted-foreground text-xs">
              <Kbd>Z</Kbd> undoes the last archive
            </p>
          )}
        </div>
      );
    }
    if (!card) {
      return null;
    }
    const typeLabel = CARD_TYPE_LABELS[card.type as CardType] ?? "Card";
    return (
      <div className="relative flex w-full max-w-md flex-col items-center">
        {leaving && (
          <div
            aria-hidden="true"
            className={cn(
              "fade-out-0 pointer-events-none absolute inset-x-0 top-0 z-10 flex animate-out justify-center fill-mode-forwards duration-180",
              leaving.move === "archive"
                ? "motion-safe:slide-out-to-left-24"
                : "motion-safe:slide-out-to-right-24"
            )}
            key={`leaving-${leaving.card._id}`}
            onAnimationEnd={() => setLeaving(null)}
          >
            <DeckCard card={leaving.card} />
          </div>
        )}
        <div
          className={cn(
            "fade-in-0 flex w-full animate-in touch-pan-y select-none justify-center duration-180",
            enterClass,
            !drag &&
              "transition-transform duration-200 motion-reduce:transition-none"
          )}
          key={card._id}
          onClickCapture={(event) => {
            if (dragged.current) {
              event.stopPropagation();
              dragged.current = false;
            }
          }}
          onPointerCancel={() => setDrag(null)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            transform: dragOffset
              ? `translateX(${dragOffset}px) rotate(${dragOffset / 40}deg)`
              : undefined,
          }}
        >
          <button
            aria-label={`Open details: ${typeLabel}`}
            className="w-full cursor-pointer rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onOpenCard(card._id)}
            type="button"
          >
            <div className="flex justify-center">
              <DeckCard card={card} />
            </div>
          </button>
        </div>
        <div className="mt-3 flex min-h-6 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
          <span>{typeLabel}</span>
          <span aria-hidden="true">·</span>
          <span>Saved {savedDate.format(card.createdAt)}</span>
          {live?.isDeleted && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              In Trash
            </span>
          )}
          {!live?.isDeleted && live?.isArchived && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              Archived
            </span>
          )}
          {swipeHint && (
            <span className="font-medium text-foreground">
              {swipeHint === "archive"
                ? "Release to archive"
                : "Release to keep"}
            </span>
          )}
        </div>
      </div>
    );
  };

  const showActions = deck.status === "ready" && !deck.done && deck.total > 0;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onExit();
        }
      }}
      open={open}
    >
      <DialogContent
        className="fixed top-0 left-0 h-dvh w-dvw max-w-none translate-x-0! translate-y-0! transform-none overscroll-contain rounded-none! border-0 p-0 shadow-none outline-none [--revisit-card-height:min(50dvh,34rem)] sm:max-w-none"
        data-revisit-deck=""
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        ref={contentRef}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Revisit</DialogTitle>
        <DialogDescription className="sr-only">
          One card at a time. Left arrow archives it, right arrow keeps it,
          Space opens its details, Z undoes the last archive and Escape leaves.
        </DialogDescription>
        <div className="flex h-dvh w-full flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="font-medium">Revisit</span>
            {deck.status === "ready" && deck.total > 0 && !deck.done ? (
              <DeckProgress position={deck.position} total={deck.total} />
            ) : (
              <span />
            )}
            <Button
              aria-label="Close Revisit"
              className="size-9 text-muted-foreground"
              onClick={onExit}
              size="icon"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </header>
          <main
            aria-live="polite"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-hidden px-4"
          >
            {renderBody()}
            {showActions && (
              <div className="flex flex-col items-center gap-3">
                <div className="flex gap-3">
                  <Button
                    disabled={deck.pending}
                    onClick={() => act("archive")}
                    size="lg"
                  >
                    {deck.pending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Archive />
                    )}
                    Archive
                    <Kbd className="border-transparent bg-primary-foreground/20 text-primary-foreground max-sm:hidden">
                      <ArrowLeft />
                    </Kbd>
                  </Button>
                  <Button
                    disabled={deck.pending}
                    onClick={() => act("keep")}
                    size="lg"
                    variant="outline"
                  >
                    Keep
                    <Kbd className="max-sm:hidden">
                      <ArrowRight />
                    </Kbd>
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs max-sm:hidden">
                  <Kbd>Space</Kbd> details · <Kbd>Z</Kbd> undo · <Kbd>Esc</Kbd>{" "}
                  exit
                </p>
                <p className="text-muted-foreground text-xs sm:hidden">
                  Swipe left to archive, right to keep
                </p>
              </div>
            )}
          </main>
          <div aria-hidden="true" className="h-20 shrink-0" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
