import { replaceCardLinkTokens } from "./cardLinks";
import type { Doc } from "./types";
import { urlHostForDisplay } from "./utils/urlHost";

export const MAX_CARD_TITLE_LENGTH = 512;

const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

/**
 * Trims a title and cuts one past `MAX_CARD_TITLE_LENGTH`, never leaving
 * half of a character that takes two UTF-16 units.
 */
export const truncateCardTitle = (value: string): string => {
  const title = value.trim();
  if (title.length <= MAX_CARD_TITLE_LENGTH) {
    return title;
  }
  return title
    .slice(0, MAX_CARD_TITLE_LENGTH)
    .replace(LONE_HIGH_SURROGATE, "")
    .trimEnd();
};

export type ParsedCardTitle =
  | { kind: "title"; title: string }
  | { kind: "clear" }
  | { kind: "invalid" };

export const parseCardTitle = (value: unknown): ParsedCardTitle => {
  if (value === null) {
    return { kind: "clear" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid" };
  }
  const title = truncateCardTitle(value);
  return title ? { kind: "title", title } : { kind: "clear" };
};

/**
 * A card's own title, by precedence: one the person typed, its link
 * preview's, then the stored one. Each surface adds its own fallbacks.
 */
export const cardOwnTitle = (card: {
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  previewTitle?: string;
}): string | undefined =>
  (card.metadataTitleEdited ? card.metadataTitle : undefined) ||
  card.previewTitle ||
  card.metadataTitle ||
  undefined;

const CONTENT_PREVIEW_LENGTH = 280;
const LINE_BREAK = /\r?\n/;

type TitledCard = Pick<
  Doc<"cards">,
  | "aiTranscriptPreview"
  | "content"
  | "fileMetadata"
  | "metadata"
  | "metadataTitle"
  | "metadataTitleEdited"
  | "type"
  | "url"
>;

export const cardPreviewText = (
  card: TitledCard,
  linkTitle: (title: string, id: string) => string = (title) => title
): string | undefined =>
  (card.type === "audio"
    ? card.aiTranscriptPreview
    : replaceCardLinkTokens(card.content ?? "", linkTitle)
  )
    ?.trim()
    .slice(0, CONTENT_PREVIEW_LENGTH) || undefined;

/**
 * The title the server gives a card (search summaries, card links): its own
 * title, its file name, its site, then its first line of text.
 */
export const cardDisplayTitle = (
  card: TitledCard,
  previewText = cardPreviewText(card)
): string =>
  cardOwnTitle({
    metadataTitle: card.metadataTitle,
    metadataTitleEdited: card.metadataTitleEdited,
    previewTitle:
      card.metadata?.linkPreview?.status === "success"
        ? card.metadata.linkPreview.title
        : undefined,
  }) ||
  card.fileMetadata?.fileName ||
  (card.type === "link" ? urlHostForDisplay(card.url) : undefined) ||
  previewText?.split(LINE_BREAK, 1)[0] ||
  (card.type === "palette" ? "Color palette" : "Saved card");
