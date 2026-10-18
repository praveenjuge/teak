import { DECISION_TEXT_LIMITS, DECISION_VERSIONS } from "@teak/files-protocol";

export const RELEVANCE_CANDIDATE_LIMIT = 64;

export const RELEVANCE_HOLD_MS = 400;

export interface RelevanceScore {
  cardId: string;
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
