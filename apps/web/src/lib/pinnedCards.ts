import type { Doc } from "@teak/convex/_generated/dataModel";
import { PIN_ERROR_CODES } from "@teak/convex/shared/pins";
import { ConvexError } from "convex/values";
import type { CardsSearchQueryArgs } from "./cardsSearchState";
import type { LibraryView } from "./libraryViews";

/**
 * The pinned strip shows on the plain library: the All view with no search,
 * filter, folder or sort other than newest. Anywhere else pinned cards list
 * where they'd rank, with their pin mark.
 */
export function showsPinnedStrip({
  isFolderView,
  queryArgs,
  view,
}: {
  isFolderView: boolean;
  queryArgs: CardsSearchQueryArgs;
  view: LibraryView;
}): boolean {
  return (
    view === "all" &&
    !isFolderView &&
    !(
      queryArgs.searchQuery ||
      queryArgs.types?.length ||
      queryArgs.tag ||
      queryArgs.styleFilters?.length ||
      queryArgs.hueFilters?.length ||
      queryArgs.hexFilters?.length ||
      queryArgs.createdAtRange ||
      queryArgs.favoritesOnly ||
      queryArgs.showArchivedOnly ||
      queryArgs.showTrashOnly ||
      queryArgs.sort
    )
  );
}

export const isPinned = (card: Pick<Doc<"cards">, "pinPosition">): boolean =>
  card.pinPosition !== undefined;

/** Pins `card` first, the way the server places a new pin. */
export function withPinnedFirst<T extends Doc<"cards">>(
  pinned: readonly T[],
  card: T
): T[] {
  const first = pinned[0]?.pinPosition;
  return [
    { ...card, pinPosition: first === undefined ? 0 : first - 1 },
    ...pinned.filter((candidate) => candidate._id !== card._id),
  ];
}

/** The pinned cards in `cardIds`' order, numbered the way the server does. */
export function inPinOrder<T extends Doc<"cards">>(
  pinned: readonly T[],
  cardIds: readonly string[]
): T[] {
  const byId = new Map(pinned.map((card) => [card._id as string, card]));
  return cardIds.flatMap((id, index) => {
    const card = byId.get(id);
    return card ? [{ ...card, pinPosition: index }] : [];
  });
}

/** Moves the card at `from` to `to`, for a drop or a keyboard move. */
export function movedIds(
  ids: readonly string[],
  from: number,
  to: number
): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return next;
  }
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

export const isPinLimitError = (error: unknown): boolean =>
  error instanceof ConvexError &&
  (error.data as { code?: unknown } | null)?.code ===
    PIN_ERROR_CODES.PIN_LIMIT_REACHED;
