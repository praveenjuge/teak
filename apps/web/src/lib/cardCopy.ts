import type { Id } from "@teak/convex/_generated/dataModel";
import { cardLinkTokensToText } from "@teak/convex/shared/cardLinks";
import { hasEditableText } from "./cardTypes";

/**
 * What copying a card puts on the clipboard. The card's menu, its ⌘C or
 * Ctrl+C in the grid, and C or "Copy" in the card dialog all read this, so
 * a card copies the same thing wherever it is copied from.
 */
export type CardCopyKind = "image" | "link" | "text";

export interface CopyableCard {
  content?: string;
  fileMetadata?: { mimeType?: string };
  isDeleted?: boolean;
  type?: string;
  url?: string;
}

// The clipboard holds PNGs, which an SVG isn't.
const copiesImageFile = (card: CopyableCard) =>
  card.type === "image" && card.fileMetadata?.mimeType !== "image/svg+xml";

/**
 * An image copies its picture; anything else with a link copies the link;
 * a note or quote copies its text. A card in Trash copies nothing.
 */
export function cardCopyKind(card: CopyableCard): CardCopyKind | null {
  if (card.isDeleted) {
    return null;
  }
  if (copiesImageFile(card)) {
    return "image";
  }
  if (card.url) {
    return "link";
  }
  if (hasEditableText(card.type)) {
    return "text";
  }
  return null;
}

/**
 * The text a link or note copies: its link, or its text with card links
 * written as plain titles. `content` is the text being edited, when it is
 * newer than the card's. Empty for an image, or for nothing to copy.
 */
export function cardCopyText(
  card: CopyableCard,
  content: string | undefined = card.content
): string {
  const kind = cardCopyKind(card);
  if (kind === "link") {
    return card.url ?? "";
  }
  return kind === "text" ? cardLinkTokensToText(content ?? "") : "";
}

/**
 * The image's original file to copy: a fresh address for it when the card
 * has a stored file, so a grid's smaller preview is never what's copied.
 */
export async function resolveImageCopyUrl({
  cardId,
  fallbackUrl,
  fileKey,
  refresh,
}: {
  cardId: string;
  fallbackUrl: string;
  fileKey?: string;
  refresh: (args: {
    cardId: Id<"cards">;
    key: string;
  }) => Promise<{ url: string }>;
}): Promise<string> {
  if (!fileKey) {
    return fallbackUrl;
  }
  const { url } = await refresh({
    cardId: cardId as Id<"cards">,
    key: fileKey,
  });
  return url;
}
