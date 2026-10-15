import { CARD_EMBEDDING_VERSION } from "@teak/files-protocol";
import type { Doc } from "../_generated/dataModel";

const BODY_CHARS = 2000;
const MAX_TEXT_CHARS = 8000;

export type EmbeddableCard = Pick<
  Doc<"cards">,
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
 * styles, then the start of the card's body (its content, else the text
 * extracted from its file, else its transcript). Empty when the card has no
 * text yet, as an image still waiting for AI.
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
    body?.slice(0, BODY_CHARS),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
};

/** Identifies what a vector was made from, including the embedding version. */
export const embeddingHash = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${CARD_EMBEDDING_VERSION}\n${text}`)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
