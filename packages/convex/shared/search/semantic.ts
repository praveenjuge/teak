import { normalizeHexColor } from "../utils/colorUtils";
import type { ParsedSearchQuery, SearchSimilarity } from "./qualifiers";

/**
 * How a search finds cards: `hybrid` blends keyword and meaning matches,
 * `keyword` matches words only (search before meaning), `semantic` matches
 * meaning only. Every mode applies the same filters and sort.
 */
export const SEARCH_MODES = ["hybrid", "keyword", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const isSearchMode = (value: unknown): value is SearchMode =>
  (SEARCH_MODES as readonly unknown[]).includes(value);

/**
 * Cosine score a meaning-only match needs. Real matches score about 0.4 to
 * 0.5 with EmbeddingGemma; unrelated cards about 0.15 to 0.3.
 */
export const SEMANTIC_MIN_SCORE = 0.35;
/** Meaning matches one search asks for (Vectorize's limit). */
export const SEMANTIC_TOP_K = 100;
/** Reciprocal rank fusion's constant: a lower rank weighs less, slowly. */
export const RRF_K = 60;
/** Longest text a search embeds (the worker's `vector-query` limit). */
export const SEMANTIC_QUERY_MAX_CHARS = 500;
/** Shortest text worth embedding. */
const SEMANTIC_QUERY_MIN_CHARS = 2;

/**
 * The free words of a search, as embedded: plain words and quoted phrases,
 * without qualifiers or hex colors, lowercased and with whitespace collapsed.
 * Empty when there is nothing to search by meaning, so a qualifier-only
 * search never calls the vector service.
 */
export const semanticQueryText = (parsed: ParsedSearchQuery): string => {
  // `#fff` is a color filter; a bare `bed` or `red` is a word.
  const words = parsed.terms.filter(
    (term) => !(term.startsWith("#") && normalizeHexColor(term))
  );
  const text = [...words, ...parsed.phrases]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, SEMANTIC_QUERY_MAX_CHARS)
    .trim();
  return text.length >= SEMANTIC_QUERY_MIN_CHARS ? text : "";
};

export interface SemanticMatch<Id extends string = string> {
  cardId: Id;
  score: number;
}

/**
 * The ids a search keeps, best first. `keyword` is the keyword side's
 * relevance order; `semantic` is Vectorize's score order. Hybrid adds
 * `1 / (k + rank)` from each side a card is on (reciprocal rank fusion) and
 * drops meaning-only matches below `minScore`; ties keep the keyword order,
 * then the semantic order.
 */
export const fuseRankings = <Id extends string>(
  keyword: readonly Id[],
  semantic: readonly SemanticMatch<Id>[],
  options: {
    mode: SearchMode;
    limit: number;
    minScore?: number;
    k?: number;
  }
): Id[] => {
  const { mode, limit } = options;
  const minScore = options.minScore ?? SEMANTIC_MIN_SCORE;
  const k = options.k ?? RRF_K;
  if (mode === "keyword") {
    return Array.from(new Set(keyword)).slice(0, limit);
  }
  const bySemanticScore = [...semantic].sort(
    (left, right) => right.score - left.score
  );
  if (mode === "semantic") {
    return Array.from(
      new Set(
        bySemanticScore
          .filter((match) => match.score >= minScore)
          .map((match) => match.cardId)
      )
    ).slice(0, limit);
  }
  const fused = new Map<Id, { score: number; order: number }>();
  let order = 0;
  const add = (id: Id, rank: number) => {
    const entry = fused.get(id);
    if (entry) {
      entry.score += 1 / (k + rank);
    } else {
      fused.set(id, { score: 1 / (k + rank), order });
      order += 1;
    }
  };
  const seenKeyword = new Set<Id>();
  for (const id of keyword) {
    if (!seenKeyword.has(id)) {
      seenKeyword.add(id);
      add(id, seenKeyword.size);
    }
  }
  const seenSemantic = new Set<Id>();
  for (const match of bySemanticScore) {
    if (seenSemantic.has(match.cardId)) {
      continue;
    }
    seenSemantic.add(match.cardId);
    if (match.score >= minScore || seenKeyword.has(match.cardId)) {
      add(match.cardId, seenSemantic.size);
    }
  }
  return Array.from(fused.entries())
    .sort(
      ([, left], [, right]) =>
        right.score - left.score || left.order - right.order
    )
    .slice(0, limit)
    .map(([id]) => id);
};

/**
 * What a search asks the vector service for, and the text its cached ranking
 * is keyed by: a `like:` card's neighbors, a `mood:` among images, or the
 * free words. Null when there is nothing to search by meaning.
 */
export type SemanticRequest =
  | { kind: "text"; text: string; cacheText: string }
  | { kind: "like"; cardId: string; cacheText: string }
  | { kind: "mood"; text: string; cacheText: string };

const normalizeMood = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, SEMANTIC_QUERY_MAX_CHARS);

export const similarityRequest = (
  similarity: SearchSimilarity
): SemanticRequest =>
  similarity.kind === "like"
    ? {
        kind: "like",
        cardId: similarity.cardId,
        // A newline never survives in free text, so keys never collide.
        cacheText: `like\n${similarity.cardId}`,
      }
    : {
        kind: "mood",
        text: normalizeMood(similarity.text),
        cacheText: `mood\n${normalizeMood(similarity.text)}`,
      };

export const semanticRequestFor = (
  parsed: ParsedSearchQuery
): SemanticRequest | null => {
  if (parsed.similarity) {
    return similarityRequest(parsed.similarity);
  }
  const text = semanticQueryText(parsed);
  return text ? { kind: "text", text, cacheText: text } : null;
};

/** Cards one similarity search lists at most. */
export const SIMILAR_CARDS_LIMIT = 100;
