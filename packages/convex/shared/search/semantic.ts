import {
  VECTOR_QUERY_MAX_CHARS,
  VECTOR_QUERY_MAX_TOP_K,
} from "@teak/files-protocol";
import { normalizeHexColor } from "../utils/colorUtils";
import { expressionIndexWords } from "./expression";
import type { ParsedSearchQuery, SearchSimilarity } from "./qualifiers";

export const SEARCH_MODES = ["hybrid", "keyword", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const isSearchMode = (value: unknown): value is SearchMode =>
  (SEARCH_MODES as readonly unknown[]).includes(value);

// EmbeddingGemma scores real matches about 0.4 to 0.5 and unrelated cards
// about 0.15 to 0.3.
export const SEMANTIC_MIN_SCORE = 0.35;
export const SEMANTIC_TOP_K = VECTOR_QUERY_MAX_TOP_K;
export const RRF_K = 60;
export const SEMANTIC_QUERY_MAX_CHARS = VECTOR_QUERY_MAX_CHARS;
const SEMANTIC_QUERY_MIN_CHARS = 2;

/**
 * The words a search embeds: its words and phrases, including those in OR
 * groups, but never excluded ones or hex colors.
 */
export const semanticQueryText = (parsed: ParsedSearchQuery): string => {
  const words = [
    ...parsed.terms,
    ...parsed.phrases,
    ...expressionIndexWords(parsed.expression),
  ].filter((term) => !(term.startsWith("#") && normalizeHexColor(term)));
  const text = words
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

export const SIMILAR_CARDS_LIMIT = 100;
