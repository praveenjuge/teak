import type { Doc } from "../../_generated/dataModel";
import { cardLinkTokensToText } from "../cardLinks";

/** The card fields keyword search reads, besides tags and extracted text. */
export const CARD_SEARCH_TEXT_FIELDS = [
  "content",
  "notes",
  "aiSummary",
  "aiTranscript",
  "aiOcrText",
  "metadataTitle",
  "metadataDescription",
] as const;

type SearchTextCard = Partial<
  Pick<
    Doc<"cards">,
    Exclude<(typeof CARD_SEARCH_TEXT_FIELDS)[number], "aiTranscript">
  >
> &
  Pick<Doc<"cards">, "aiTags" | "tags">;

export const buildCardSearchText = (
  card: SearchTextCard,
  extractedText?: string,
  transcript?: string
): string => {
  const fieldValues = new Map<string, unknown>(Object.entries(card));
  return [
    ...CARD_SEARCH_TEXT_FIELDS.map((field) => {
      if (field === "content" && card.content) {
        return cardLinkTokensToText(card.content);
      }
      return field === "aiTranscript" ? transcript : fieldValues.get(field);
    }),
    ...(card.tags ?? []),
    ...(card.aiTags ?? []),
    extractedText,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .join("\n");
};

export const normalizeCardSearchTag = (tag: string): string =>
  tag.trim().toLowerCase();

export const buildCardSearchTags = (
  card: Pick<Doc<"cards">, "tags" | "aiTags">
): string[] =>
  Array.from(
    new Set(
      [...(card.tags ?? []), ...(card.aiTags ?? [])]
        .map(normalizeCardSearchTag)
        .filter(Boolean)
    )
  ).sort();
