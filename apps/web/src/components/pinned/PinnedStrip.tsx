import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import type { KeyboardEvent } from "react";
import { useMemo, useRef, useState } from "react";
import type {
  CardGridSource,
  GridCardAction,
} from "../../hooks/useCardActions";
import type { CardActionId } from "../../lib/cardActions";
import { type GridKeyContext, gridKeyAction } from "../../lib/gridKeys";
import { movedIds } from "../../lib/pinnedCards";
import { cn } from "../../lib/utils";
import { Card, type CardWithUrls } from "../cards/Card";
import type { CardOpenOrigin } from "../cards/types";
import { CardFoldersDialog, EditLinkDialog } from "../lazyDialogs";

type StripCard = Doc<"cards">;

const STRIP_KEY_CONTEXT: GridKeyContext = {
  addToFolder: false,
  allSelectedFavorited: false,
  hasSelection: false,
  isSelectionMode: false,
  view: "library",
};

/** The row has no selection, and nothing in it is in Trash. */
const STRIP_CARD_ACTIONS: ReadonlySet<CardActionId> = new Set([
  "copy",
  "favorite",
  "pin",
  "addTags",
  "archive",
  "moveToTrash",
]);

// Drags announce through the row's own status line, after the drop.
const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

export interface PinnedStripProps {
  cards: StripCard[];
  onCardAction?: (
    action: GridCardAction,
    card: StripCard,
    source: CardGridSource
  ) => void;
  onCardClick: (
    card: CardWithUrls & Record<string, unknown>,
    origin?: CardOpenOrigin
  ) => void;
  onCopyImage?: (content: string | Promise<string>, isImage: boolean) => void;
  onReorder: (cardIds: Id<"cards">[]) => void;
}

/**
 * The pinned cards in one row above the library, first to last. Drag a
 * card to move it, or focus it and press Alt with an arrow key.
 */
export function PinnedStrip({
  cards,
  onCardAction,
  onCardClick,
  onCopyImage,
  onReorder,
}: PinnedStripProps) {
  const t = useTranslations("pinned.strip");
  const ids = useMemo(() => cards.map((card) => card._id as string), [cards]);
  const listRef = useRef<HTMLUListElement>(null);
  const [announcement, setAnnouncement] = useState("");
  // The grid's Folders and Edit link dialogs don't reach cards here.
  const [foldersCardId, setFoldersCardId] = useState<string | null>(null);
  const [editLinkCardId, setEditLinkCardId] = useState<string | null>(null);
  const foldersCard = cards.find((card) => card._id === foldersCardId);
  const editLinkCard = cards.find((card) => card._id === editLinkCardId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A touch has to rest on a card before it moves it, so a swipe still
    // scrolls the row.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );

  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= ids.length || from === to) {
      return false;
    }
    onReorder(movedIds(ids, from, to) as Id<"cards">[]);
    setAnnouncement(t("moved", { position: to + 1, count: ids.length }));
    return true;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) {
      move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    }
  };

  // Cards here aren't in the grid, so the grid's keys don't reach them;
  // the same keys act on the focused card here, and Alt with an arrow key
  // moves it in the row.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const cardId = (event.target as HTMLElement).dataset?.cardId;
    if (!cardId || event.defaultPrevented || event.repeat) {
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (
      step !== undefined &&
      event.altKey &&
      !(event.ctrlKey || event.metaKey || event.shiftKey)
    ) {
      const from = ids.indexOf(cardId);
      if (move(from, from + step)) {
        event.preventDefault();
        // Reordering moves the card's element in the page, and the browser
        // drops focus from an element it moves: give it back once moved.
        requestAnimationFrame(() =>
          listRef.current
            ?.querySelector<HTMLElement>(
              `[data-card-id="${globalThis.CSS.escape(cardId)}"]`
            )
            ?.focus()
        );
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const card = cards.find((candidate) => candidate._id === cardId);
    const action =
      card &&
      gridKeyAction(
        event.key.length === 1 ? event.key.toLowerCase() : event.key,
        STRIP_KEY_CONTEXT,
        card
      );
    if (
      card &&
      action?.type === "card" &&
      STRIP_CARD_ACTIONS.has(action.action)
    ) {
      event.preventDefault();
      onCardAction?.(action.action as GridCardAction, card, "shortcut");
    }
  };

  const handleMenuAction = (
    action: CardActionId,
    card: CardWithUrls & Record<string, unknown>
  ) => {
    if (STRIP_CARD_ACTIONS.has(action)) {
      onCardAction?.(
        action as GridCardAction,
        card as unknown as StripCard,
        "grid"
      );
    }
  };

  if (cards.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="pinned-strip-title" className="mb-6">
      <h2
        className="mb-2 font-medium text-muted-foreground text-sm"
        id="pinned-strip-title"
      >
        {t("title")}
      </h2>
      <DndContext
        accessibility={{ announcements: SILENT }}
        collisionDetection={closestCenter}
        // dnd-kit stops the click that ends a drag, so a drop never opens
        // the card under the pointer.
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: keys and clicks reach the list from the focused card, which is the interactive element */}
          <ul
            aria-describedby="pinned-strip-help"
            aria-label={t("ariaLabel")}
            className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-1 pb-3"
            data-pinned-strip=""
            onKeyDown={handleKeyDown}
            ref={listRef}
          >
            {cards.map((card) => (
              <PinnedStripItem
                card={card}
                key={card._id}
                onAction={handleMenuAction}
                onCardClick={onCardClick}
                onCopyImage={onCopyImage}
                onEditFolders={setFoldersCardId}
                onEditLink={setEditLinkCardId}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p className="sr-only" id="pinned-strip-help">
        {t("instructions")}
      </p>
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      <CardFoldersDialog
        cardId={foldersCard ? foldersCard._id : null}
        folderIds={(foldersCard?.folderIds ?? []) as string[]}
        onOpenChange={(open) => {
          if (!open) {
            setFoldersCardId(null);
          }
        }}
        open={foldersCard !== undefined}
      />
      <EditLinkDialog
        card={
          editLinkCard?.url
            ? { id: editLinkCard._id, url: editLinkCard.url }
            : null
        }
        onOpenChange={(open) => {
          if (!open) {
            setEditLinkCardId(null);
          }
        }}
        open={Boolean(editLinkCard?.url)}
      />
    </section>
  );
}

function PinnedStripItem({
  card,
  onAction,
  onCardClick,
  onCopyImage,
  onEditFolders,
  onEditLink,
}: Pick<PinnedStripProps, "onCardClick" | "onCopyImage"> & {
  card: StripCard;
  onAction: (
    action: CardActionId,
    card: CardWithUrls & Record<string, unknown>
  ) => void;
  onEditFolders: (cardId: string) => void;
  onEditLink: (cardId: string) => void;
}) {
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({ id: card._id });
  return (
    <li
      className={cn(
        "relative w-48 shrink-0 cursor-grab touch-pan-x snap-start sm:w-56",
        isDragging && "z-30 cursor-grabbing opacity-80"
      )}
      data-pinned-card-id={card._id}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
    >
      <Card
        actions={STRIP_CARD_ACTIONS}
        card={card as CardWithUrls & Record<string, unknown>}
        nativeDrag={false}
        onAction={onAction}
        onClick={onCardClick}
        onCopyImage={onCopyImage}
        onEditFolders={onEditFolders}
        onEditLink={onEditLink}
      />
    </li>
  );
}
