/**
 * A card tile marks its element with its id, so a grid or row can find and
 * focus it. Optimistic cards and the first paint's copies carry no id: they
 * can't be focused or opened yet.
 */
export const CARD_ID_ATTRIBUTE = "data-card-id";

/** The id of the card tile `element` is, if it is one. */
export const cardIdOf = (element: Element | null | undefined) =>
  element instanceof HTMLElement ? element.dataset.cardId : undefined;

/** The card tile for `cardId` inside `root`. */
export const cardElement = (
  root: ParentNode | null | undefined,
  cardId: string
): HTMLElement | null =>
  root?.querySelector<HTMLElement>(
    `[${CARD_ID_ATTRIBUTE}="${CSS.escape(cardId)}"]`
  ) ?? null;

/** Every card tile inside `root`, by id. */
export const cardElements = (
  root: ParentNode | null | undefined
): Map<string, HTMLElement> =>
  new Map(
    Array.from(
      root?.querySelectorAll<HTMLElement>(`[${CARD_ID_ATTRIBUTE}]`) ?? [],
      (element) => [element.dataset.cardId ?? "", element]
    )
  );
