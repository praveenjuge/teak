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
import type { KeyboardEvent, MouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  type GridCardKeyAction,
  type GridKeyContext,
  gridKeyAction,
} from "../../lib/gridKeys";
import { movedIds } from "../../lib/pinnedCards";
import { cn } from "../../lib/utils";
import { Card, type CardWithUrls } from "../cards/Card";

type StripCard = Doc<"cards">;

const STRIP_KEY_CONTEXT: GridKeyContext = {
  addToFolder: false,
  allSelectedFavorited: false,
  hasSelection: false,
  isSelectionMode: false,
  view: "library",
};

// Drags announce through the row's own status line, after the drop.
const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

export interface PinnedStripProps {
  cards: StripCard[];
  onAddTags?: (cardId: string) => void;
  onCardClick: (card: CardWithUrls & Record<string, unknown>) => void;
  onCopyImage?: (content: string, isImage: boolean) => void;
  onDeleteCard?: (cardId: string) => unknown;
  onReorder: (cardIds: Id<"cards">[]) => void;
  onToggleArchive?: (cardId: string, archive: boolean) => void;
  onToggleFavorite?: (cardId: string) => void;
  onTogglePin: (cardId: string, source?: "grid" | "shortcut") => void;
}

/**
 * The pinned cards in one row above the library, first to last. Drag a
 * card to move it, or focus it and press Alt with an arrow key.
 */
export function PinnedStrip({
  cards,
  onAddTags,
  onCardClick,
  onCopyImage,
  onDeleteCard,
  onReorder,
  onToggleArchive,
  onTogglePin,
  onToggleFavorite,
}: PinnedStripProps) {
  const t = useTranslations("pinned.strip");
  const ids = useMemo(() => cards.map((card) => card._id as string), [cards]);
  const listRef = useRef<HTMLUListElement>(null);
  const [announcement, setAnnouncement] = useState("");
  // A drag ends with a click on the card under the pointer; that click
  // shouldn't open it.
  const draggedRef = useRef<boolean>(false);
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
        requestAnimationFrame(() =>
          listRef.current
            ?.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)
            ?.focus()
        );
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const action = gridKeyAction(
      event.key.length === 1 ? event.key.toLowerCase() : event.key,
      STRIP_KEY_CONTEXT
    );
    if (action?.type !== "card") {
      return;
    }
    const run: Partial<Record<GridCardKeyAction, () => void>> = {
      addTags: onAddTags && (() => onAddTags(cardId)),
      archive: onToggleArchive && (() => onToggleArchive(cardId, true)),
      delete: onDeleteCard && (() => onDeleteCard(cardId)),
      favorite: onToggleFavorite && (() => onToggleFavorite(cardId)),
      pin: () => onTogglePin(cardId, "shortcut"),
    };
    const handler = run[action.action];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };

  const swallowClickAfterDrag = (event: MouseEvent<HTMLElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
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
        onDragCancel={() => {
          draggedRef.current = false;
        }}
        onDragEnd={handleDragEnd}
        onDragStart={() => {
          draggedRef.current = true;
        }}
        sensors={sensors}
      >
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: keys and clicks reach the list from the focused card, which is the interactive element */}
          <ul
            aria-describedby="pinned-strip-help"
            aria-label={t("ariaLabel")}
            className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-1 pb-3"
            data-pinned-strip=""
            onClickCapture={swallowClickAfterDrag}
            onKeyDown={handleKeyDown}
            ref={listRef}
          >
            {cards.map((card) => (
              <PinnedStripItem
                card={card}
                key={card._id}
                onAddTags={onAddTags}
                onCardClick={onCardClick}
                onCopyImage={onCopyImage}
                onDeleteCard={onDeleteCard}
                onToggleArchive={onToggleArchive}
                onToggleFavorite={onToggleFavorite}
                onTogglePin={onTogglePin}
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
    </section>
  );
}

function PinnedStripItem({
  card,
  onAddTags,
  onCardClick,
  onCopyImage,
  onDeleteCard,
  onToggleArchive,
  onToggleFavorite,
  onTogglePin,
}: Omit<PinnedStripProps, "cards" | "onReorder"> & { card: StripCard }) {
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
        card={card as CardWithUrls & Record<string, unknown>}
        nativeDrag={false}
        onAddTags={onAddTags}
        onClick={onCardClick}
        onCopyImage={onCopyImage}
        onDelete={onDeleteCard}
        onToggleArchive={onToggleArchive}
        onToggleFavorite={onToggleFavorite}
        onTogglePin={onTogglePin}
      />
    </li>
  );
}
