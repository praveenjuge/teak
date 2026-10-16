import { DECISION_TEXT_LIMITS, DECISION_VERSIONS } from "@teak/files-protocol";

/**
 * Best match: Clef scores how well each of a search's top results matches
 * its words, 0 to 3. Scores are per card and per search text, because Clef
 * judges each card on its own; filters only change which cards get scored.
 */

/** How many of a search's top results get a score. */
export const RELEVANCE_CANDIDATE_LIMIT = 64;

/** How long the grid waits for scores before it shows the unscored order. */
export const RELEVANCE_HOLD_MS = 400;

export interface RelevanceScore {
  cardId: string;
  /** The card's `updatedAt` when scored; an edited card is scored again. */
  cardUpdatedAt: number;
  score: number;
}

interface RelevanceCard {
  _id: string;
  aiSummary?: string;
  aiTags?: string[];
  content?: string;
  metadata?: {
    linkPreview?: { description?: string; status?: string; title?: string };
  };
  metadataTitle?: string;
  notes?: string;
  tags?: string[];
  type: string;
  updatedAt: number;
  urlHost?: string;
}

/**
 * The short description of a card Clef judges: its type, title, site,
 * summary, tags and the start of its text.
 */
export const buildRelevanceCardText = (card: RelevanceCard): string => {
  const preview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const tags = [...(card.tags ?? []), ...(card.aiTags ?? [])].slice(0, 6);
  return [
    `Type: ${card.type}`,
    card.metadataTitle || preview?.title
      ? `Title: ${card.metadataTitle || preview?.title}`
      : "",
    card.urlHost ? `Site: ${card.urlHost}` : "",
    preview?.description ? `Description: ${preview.description}` : "",
    card.aiSummary ? `Summary: ${card.aiSummary}` : "",
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    card.notes ? `Notes: ${card.notes}` : "",
    card.content ? `Text: ${card.content.slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, DECISION_TEXT_LIMITS.relevanceCardText);
};

/** Scores that still describe the cards as they are now. */
export const currentRelevanceScores = (
  scores: readonly RelevanceScore[] | null | undefined,
  cards: readonly { _id: string; updatedAt: number }[]
): Map<string, number> => {
  const updatedAt = new Map(cards.map((card) => [card._id, card.updatedAt]));
  const current = new Map<string, number>();
  for (const entry of scores ?? []) {
    if (updatedAt.get(entry.cardId) === entry.cardUpdatedAt) {
      current.set(entry.cardId, entry.score);
    }
  }
  return current;
};

/**
 * Best match order: scored cards first, highest score first; ties and
 * unscored cards keep the order they came in (the fused search order).
 */
export const orderByRelevance = <Card extends { _id: string }>(
  cards: readonly Card[],
  scores: ReadonlyMap<string, number>
): Card[] =>
  cards
    .map((card, index) => ({ card, index, score: scores.get(card._id) }))
    .sort((left, right) => {
      if (left.score !== undefined && right.score !== undefined) {
        return right.score - left.score || left.index - right.index;
      }
      if (left.score !== undefined) {
        return -1;
      }
      if (right.score !== undefined) {
        return 1;
      }
      return left.index - right.index;
    })
    .map(({ card }) => card);

/**
 * The cache key for a search's text: its hash with the prompt version, so
 * the table never holds what someone searched for and a new prompt never
 * reuses old scores.
 */
export const relevanceSearchKey = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `relevance:${DECISION_VERSIONS.relevance}\n${text.slice(0, DECISION_TEXT_LIMITS.relevanceQuery)}`
    )
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
