/**
 * Card embeddings for semantic search: Workers AI makes the vectors and a
 * Vectorize index per shard stores them, one namespace per user. Convex and
 * the Files Worker both read these, so a model or prompt change is one edit.
 *
 * EmbeddingGemma was chosen on a retrieval evaluation over the seeded dev
 * cards (.agents/semantic-search.md).
 */

export const CARD_EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";
/** The Vectorize index dimensions; fixed for the life of an index. */
export const CARD_EMBEDDING_DIMENSIONS = 768;
/**
 * Bump when the model, the prompts or the embedded card text change, so
 * cards embedded under an older version are embedded again.
 */
export const CARD_EMBEDDING_VERSION = 1;
/** EmbeddingGemma reads at most this many tokens and drops the rest. */
export const CARD_EMBEDDING_MAX_INPUT_TOKENS = 512;

/** Rough per-token costs, measured on EmbeddingGemma's tokenizer. */
const ASCII_TOKEN_COST = 1 / 3;
const OTHER_TOKEN_COST = 1.2;
/** Leaves room for the prompt below EmbeddingGemma's 512 tokens. */
const EMBEDDING_TOKEN_BUDGET = 480;

/**
 * Cut text to what EmbeddingGemma reads, by a conservative token estimate:
 * a third of a token per ASCII character (code is the densest, at about 3
 * characters a token) and 1.2 per other code point (emoji are the densest).
 * Measured on English, CJK, Arabic, Hindi, emoji and code, the cut text stays
 * under 470 tokens with the prompt; plain English keeps about 1,450
 * characters.
 */
export const truncateForEmbedding = (text: string): string => {
  let cost = 0;
  let end = 0;
  for (const char of text) {
    cost +=
      (char.codePointAt(0) ?? 0) < 128 ? ASCII_TOKEN_COST : OTHER_TOKEN_COST;
    if (cost > EMBEDDING_TOKEN_BUDGET) {
      break;
    }
    end += char.length;
  }
  return text.slice(0, end);
};

/** Card ids per `embed-upsert` call. */
export const EMBED_UPSERT_MAX_ITEMS = 32;
/** Ids per `vector-delete` call; Vectorize's own mutation limit is 1,000. */
export const VECTOR_DELETE_MAX_IDS = 1000;
/** Ids per `vector-get` call. */
export const VECTOR_GET_MAX_IDS = 100;
/** Matches per `vector-query`; Vectorize allows 100 without metadata. */
export const VECTOR_QUERY_MAX_TOP_K = 100;
/** Vectorize vector ids are at most 64 bytes. */
export const VECTOR_ID_MAX_BYTES = 64;
/** Longest search query `vector-query` embeds. */
export const VECTOR_QUERY_MAX_CHARS = 500;

export interface FilesEmbedUpsertParams {
  /** Card ids and the card text to embed, already built by Convex. */
  items: Array<{ id: string; text: string }>;
  namespace: string;
  shard: number;
}

export interface FilesEmbedUpsertResult {
  /** Vectorize's id for the asynchronous write. */
  mutationId: string;
  upserted: number;
}

export interface FilesVectorDeleteParams {
  ids: string[];
  shard: number;
}

export interface FilesVectorDeleteResult {
  mutationId: string;
}

export interface FilesVectorGetParams {
  ids: string[];
  shard: number;
}

export interface FilesVectorGetResult {
  /** The ids that have a vector, with the namespace each is in. */
  vectors: Array<{ id: string; namespace: string | null }>;
}

export interface FilesVectorQueryParams {
  namespace: string;
  shard: number;
  /** A search query, embedded with the query prompt. */
  text: string;
  topK: number;
}

export interface FilesVectorQueryResult {
  matches: Array<{ id: string; score: number }>;
}

export interface FilesVectorSimilarParams {
  /** The card whose vector to search with. */
  id: string;
  /** Its owner's namespace; a vector in any other namespace is not found. */
  namespace: string;
  shard: number;
  topK: number;
}

export interface FilesVectorSimilarResult {
  /** False when the card has no vector in `namespace` (yet). */
  found: boolean;
  /** Closest first, without the card itself. */
  matches: Array<{ id: string; score: number }>;
}

/** Vectorize namespace names are at most 64 bytes. */
export const VECTOR_NAMESPACE_MAX_BYTES = 64;
/** The shard new users are placed on. */
export const CURRENT_VECTOR_SHARD = 0;

// EmbeddingGemma's retrieval prompts, from its model card. Workers AI embeds
// the text as given, so they are added here.
const QUERY_PROMPT = "task: search result | query: ";
const DOCUMENT_PROMPT = "title: none | text: ";

/** The text to embed for a search query, cut to what the model reads. */
export const cardEmbeddingQuery = (query: string): string =>
  `${QUERY_PROMPT}${truncateForEmbedding(query.trim())}`;

/** The text to embed for a card, cut to what the model reads. */
export const cardEmbeddingDocument = (text: string): string =>
  `${DOCUMENT_PROMPT}${truncateForEmbedding(text.trim())}`;

/** The Vectorize index binding for a shard (`CARD_VECTORS_<shard>`). */
export const vectorShardBinding = (shard: number): string =>
  `CARD_VECTORS_${shard}`;

/** The user's namespace in their shard's index, or null if it cannot be one. */
export const vectorNamespaceForUser = (userId: string): string | null => {
  const bytes = new TextEncoder().encode(userId).byteLength;
  return userId && bytes <= VECTOR_NAMESPACE_MAX_BYTES ? userId : null;
};
