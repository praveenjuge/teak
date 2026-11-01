export const CARD_EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";
/** The Vectorize index dimensions; fixed for the life of an index. */
export const CARD_EMBEDDING_DIMENSIONS = 768;
export const CARD_EMBEDDING_VERSION = 1;

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

export const EMBED_UPSERT_MAX_ITEMS = 32;
/** Ids per `vector-delete` call; Vectorize's own mutation limit is 1,000. */
export const VECTOR_DELETE_MAX_IDS = 1000;
export const VECTOR_GET_MAX_IDS = 100;
/**
 * Matches per `vector-query`. Vectorize allows 100, or 50 when matches come
 * back with values or full metadata, so queries ask for neither.
 */
export const VECTOR_QUERY_MAX_TOP_K = 100;
/**
 * The card type each vector carries as `type` metadata. The index needs a
 * string metadata index on `type` for queries to filter on it, and a vector
 * written before that index existed is filtered only once it is upserted
 * again (architecture.mdx, "Search by meaning in detail").
 */
export const VECTOR_TYPE_METADATA_KEY = "type";
export const isVectorCardType = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z]{1,32}$/.test(value);
/** Vectorize vector ids are at most 64 bytes. */
export const VECTOR_ID_MAX_BYTES = 64;
export const VECTOR_QUERY_MAX_CHARS = 500;

export interface FilesEmbedUpsertParams {
  /**
   * Card ids and the card text to embed, already built by Convex, with the
   * card's type to store as metadata (absent from callers that predate it).
   */
  items: Array<{ id: string; text: string; type?: string }>;
  namespace: string;
  shard: number;
}

export interface FilesEmbedUpsertResult {
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
  vectors: Array<{ id: string; namespace: string | null }>;
}

export interface FilesVectorQueryParams {
  namespace: string;
  shard: number;
  text: string;
  topK: number;
  type?: string;
}

export interface FilesVectorQueryResult {
  matches: Array<{ id: string; score: number }>;
}

export interface FilesVectorSimilarParams {
  id: string;
  /** Its owner's namespace; a vector in any other namespace is not found. */
  namespace: string;
  shard: number;
  topK: number;
}

export interface FilesVectorSimilarResult {
  found: boolean;
  /** Closest first, without the card itself. */
  matches: Array<{ id: string; score: number }>;
}

/** Vectorize namespace names are at most 64 bytes. */
export const VECTOR_NAMESPACE_MAX_BYTES = 64;
export const CURRENT_VECTOR_SHARD = 0;

// EmbeddingGemma's retrieval prompts, from its model card. Workers AI embeds
// the text as given, so they are added here.
const QUERY_PROMPT = "task: search result | query: ";
const DOCUMENT_PROMPT = "title: none | text: ";

export const cardEmbeddingQuery = (query: string): string =>
  `${QUERY_PROMPT}${truncateForEmbedding(query.trim())}`;

export const cardEmbeddingDocument = (text: string): string =>
  `${DOCUMENT_PROMPT}${truncateForEmbedding(text.trim())}`;

export const vectorShardBinding = (shard: number): string =>
  `CARD_VECTORS_${shard}`;

export const vectorNamespaceForUser = (userId: string): string | null => {
  const bytes = new TextEncoder().encode(userId).byteLength;
  return userId && bytes <= VECTOR_NAMESPACE_MAX_BYTES ? userId : null;
};
