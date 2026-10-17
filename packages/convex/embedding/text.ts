import { CARD_EMBEDDING_VERSION } from "@teak/files-protocol";
import type { Doc } from "../_generated/dataModel";
import { sha256Hex } from "../storage/r2Keys";

const BODY_CHARS = 2000;
const MAX_TEXT_CHARS = 8000;

export type EmbeddableCard = Pick<
  Doc<"cards">,
  | "aiOcrText"
  | "aiSummary"
  | "aiTags"
  | "aiTranscript"
  | "content"
  | "metadata"
  | "metadataDescription"
  | "metadataTitle"
  | "notes"
  | "tags"
  | "url"
  | "visualStyles"
>;

const clean = (value: string | undefined) => value?.trim() || undefined;

/**
 * The text a card is embedded from, most telling first, since the model
 * reads only its first ~500 tokens: title, summary, tags, notes, visual
 * styles, the text read from its image, screenshot or scan, then the start
 * of the card's body (its content, else the text extracted from its file,
 * else its transcript). Empty when the card has no text yet, as an image
 * still waiting for AI.
 */
export const buildEmbeddingText = (
  card: EmbeddableCard,
  extractedText?: string
): string => {
  const preview = card.metadata?.linkPreview;
  const tags = [...(card.tags ?? []), ...(card.aiTags ?? [])]
    .map((tag) => tag.trim())
    .filter(Boolean);
  const content = clean(card.content);
  const body =
    (content && content !== clean(card.url) ? content : undefined) ??
    clean(extractedText) ??
    clean(card.aiTranscript);
  return [
    clean(card.metadataTitle) ?? clean(preview?.title),
    clean(card.metadataDescription) ?? clean(preview?.description),
    clean(card.aiSummary),
    tags.length ? `Tags: ${Array.from(new Set(tags)).join(", ")}` : undefined,
    clean(card.notes),
    card.visualStyles?.length
      ? `Style: ${card.visualStyles.join(", ")}`
      : undefined,
    clean(card.aiOcrText)?.slice(0, BODY_CHARS),
    body?.slice(0, BODY_CHARS),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
};

/**
 * Identifies what a vector was made from, including the embedding version,
 * and the card type it carries as metadata.
 */
export const embeddingHash = (text: string, type: string): Promise<string> =>
  sha256Hex(`${CARD_EMBEDDING_VERSION}\n${type}\n${text}`);
