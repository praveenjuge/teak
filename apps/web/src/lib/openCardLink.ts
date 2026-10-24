import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";

// Every place on the web that opens a link card's page goes through here. A
// link with an archived copy opens `/open/<cardId>`, which checks the page
// first and shows Teak's copy when the original is gone; any other card
// opens its address directly.

export const OPEN_CARD_PATH = "/open";

export interface OpenableCard {
  _id: string;
  isDeleted?: boolean;
  pageArchive?: unknown;
  type?: string;
  url?: string;
}

export const openCardPath = (cardId: string) =>
  `${OPEN_CARD_PATH}/${encodeURIComponent(cardId)}`;

/** Whether opening the card checks its page before it opens. */
export const opensThroughLinkCheck = (card: OpenableCard): boolean =>
  card.type === "link" &&
  Boolean(card.pageArchive) &&
  !card.isDeleted &&
  sanitizeExternalUrl(card.url) !== undefined;

/** The address a new tab opens for the card, or null when it has none. */
export const cardLinkTarget = (
  card: OpenableCard,
  appOrigin: string
): string | null => {
  if (opensThroughLinkCheck(card)) {
    return `${appOrigin}${openCardPath(card._id)}`;
  }
  return sanitizeExternalUrl(card.url) ?? null;
};

type OpenWindow = (url: string, target: string, features: string) => unknown;

interface OpenOptions {
  appOrigin?: string;
  open?: OpenWindow;
}

const browserOrigin = () =>
  typeof window === "undefined" ? "" : window.location.origin;

const browserOpen: OpenWindow = (url, target, features) =>
  window.open(url, target, features);

/**
 * Opens the card's page in a new tab, at once in the click handler so a
 * popup blocker allows it. Returns false when the card has no safe address.
 */
export const openCardLink = (
  card: OpenableCard,
  { appOrigin = browserOrigin(), open = browserOpen }: OpenOptions = {}
): boolean => {
  const target = cardLinkTarget(card, appOrigin);
  if (!target) {
    return false;
  }
  open(
    target,
    "_blank",
    opensThroughLinkCheck(card) ? "noopener" : "noopener,noreferrer"
  );
  return true;
};

interface LinkClick {
  altKey: boolean;
  button: number;
  defaultPrevented: boolean;
  preventDefault: () => void;
  shiftKey: boolean;
}

/**
 * The `onClick` for an anchor whose `href` is the card's real address. A
 * primary click or a ⌘/Ctrl-click on a link with an archived copy opens
 * `/open` instead. Middle-click, Shift and Alt clicks, and "Copy link
 * address" keep the original, because the anchor keeps its `href`.
 */
export const handleCardLinkClick = (
  event: LinkClick,
  card: OpenableCard,
  options?: OpenOptions
): void => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.shiftKey ||
    !opensThroughLinkCheck(card)
  ) {
    return;
  }
  event.preventDefault();
  openCardLink(card, options);
};
