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

/** Vectorize namespace names are at most 64 bytes. */
export const VECTOR_NAMESPACE_MAX_BYTES = 64;
/** The shard new users are placed on. */
export const CURRENT_VECTOR_SHARD = 0;

// EmbeddingGemma's retrieval prompts, from its model card. Workers AI embeds
// the text as given, so they are added here.
const QUERY_PROMPT = "task: search result | query: ";
const DOCUMENT_PROMPT = "title: none | text: ";

/** The text to embed for a search query. */
export const cardEmbeddingQuery = (query: string): string =>
  `${QUERY_PROMPT}${query.trim()}`;

/** The text to embed for a card. */
export const cardEmbeddingDocument = (text: string): string =>
  `${DOCUMENT_PROMPT}${text.trim()}`;

/** The Vectorize index binding for a shard (`CARD_VECTORS_<shard>`). */
export const vectorShardBinding = (shard: number): string =>
  `CARD_VECTORS_${shard}`;

/** The user's namespace in their shard's index, or null if it cannot be one. */
export const vectorNamespaceForUser = (userId: string): string | null => {
  const bytes = new TextEncoder().encode(userId).byteLength;
  return userId && bytes <= VECTOR_NAMESPACE_MAX_BYTES ? userId : null;
};
