import { parseSearchQuery } from "@teak/convex/shared";

/**
 * "Did you mean" for a search that found nothing: each word that isn't in the
 * person's own vocabulary (their tags, folder names and card titles) is
 * swapped for the closest word that is, within a typo or two. Pure, and only
 * run on an empty result, so it costs nothing while results show.
 */

const MIN_WORD_LENGTH = 3;
const MAX_VOCABULARY_WORDS = 5000;

const WORD_SPLIT = /[^\p{L}\p{N}'-]+/u;

/** Words from the given texts, each weighted by how often it appears. */
export function buildSearchVocabulary(
  texts: Iterable<string | undefined>
): Map<string, number> {
  const words = new Map<string, number>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const raw of text.toLowerCase().split(WORD_SPLIT)) {
      const word = raw.replace(/^[-']+|[-']+$/g, "");
      if (word.length < MIN_WORD_LENGTH || /^\d+$/.test(word)) {
        continue;
      }
      if (!words.has(word) && words.size >= MAX_VOCABULARY_WORDS) {
        continue;
      }
      words.set(word, (words.get(word) ?? 0) + 1);
    }
  }
  return words;
}

const allowedEdits = (length: number) => (length <= 4 ? 1 : 2);

/**
 * Edit distance with adjacent swaps (`kestral` → `kestrel` is one), or
 * `limit + 1` as soon as it must exceed `limit`.
 */
export function typoDistance(left: string, right: string, limit: number) {
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : 0))
  );
  for (let row = 1; row < rows; row += 1) {
    const current = table[row] as number[];
    const previous = table[row - 1] as number[];
    current[0] = row;
    let best = current[0];
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      let value = Math.min(
        (previous[col] as number) + 1,
        (current[col - 1] as number) + 1,
        (previous[col - 1] as number) + cost
      );
      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      ) {
        value = Math.min(
          value,
          ((table[row - 2] as number[])[col - 2] as number) + 1
        );
      }
      current[col] = value;
      best = Math.min(best, value);
    }
    if (best > limit) {
      return limit + 1;
    }
  }
  return (table[rows - 1] as number[])[cols - 1] as number;
}

const closestWord = (
  word: string,
  vocabulary: ReadonlyMap<string, number>
): string | null => {
  const limit = allowedEdits(word.length);
  let best: { distance: number; weight: number; word: string } | null = null;
  for (const [candidate, weight] of vocabulary) {
    const distance = typoDistance(word, candidate, limit);
    if (
      distance <= limit &&
      (!best ||
        distance < best.distance ||
        (distance === best.distance && weight > best.weight))
    ) {
      best = { distance, weight, word: candidate };
    }
  }
  return best?.word ?? null;
};

/**
 * The search with its misspelled words corrected, or null when every word
 * is already known or nothing close enough is. Only plain words change;
 * qualifiers, phrases, exclusions and groups stay as they are.
 */
export function suggestSearchSpelling(
  search: string,
  vocabulary: ReadonlyMap<string, number>
): string | null {
  const { terms } = parseSearchQuery(search);
  if (terms.length === 0 || vocabulary.size === 0) {
    return null;
  }
  const replacements = new Map<string, string>();
  for (const term of terms) {
    const word = term.toLowerCase();
    if (word.length < MIN_WORD_LENGTH || vocabulary.has(word)) {
      continue;
    }
    const closest = closestWord(word, vocabulary);
    if (closest) {
      replacements.set(term, closest);
    }
  }
  if (replacements.size === 0) {
    return null;
  }
  return search
    .split(/(\s+)/)
    .map((part) => replacements.get(part) ?? part)
    .join("");
}
