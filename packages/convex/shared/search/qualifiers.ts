import { type CardType, cardTypes } from "../constants";
import { MAX_TAG_KEY_LENGTH, tagKey } from "../tags";
import { normalizeHexColor } from "../utils/colorUtils";
import { hostForDisplay, normalizeUrlHost } from "../utils/urlHost";
import { SEARCH_TOKEN_TRIM_CHARACTERS } from "./constants";

/** The keys a search can use, as in `tag:design`. */
export const SEARCH_QUALIFIER_KEYS = [
  "tag",
  "type",
  "is",
  "site",
  "folder",
  "like",
  "mood",
] as const;
export type SearchQualifierKey = (typeof SEARCH_QUALIFIER_KEYS)[number];

export type SearchIsValue = "fav" | "archived";

/**
 * One qualifier in a search. Values are normalized: tags lowercased, sites
 * as normalized hosts (see normalizeUrlHost); folder names keep their
 * spelling and match ignoring case.
 */
export type SearchQualifier =
  | { key: "tag"; value: string }
  | { key: "type"; value: CardType }
  | { key: "is"; value: SearchIsValue }
  | { key: "site"; value: string }
  | { key: "folder"; value: string }
  /** The cards closest in meaning to this card (its id). */
  | { key: "like"; value: string }
  /** Images whose description matches this text by meaning. */
  | { key: "mood"; value: string };

/** What a search finds by meaning instead of by its words (one at most). */
export type SearchSimilarity =
  | { kind: "like"; cardId: string }
  | { kind: "mood"; text: string };

/** Longest `mood:` text kept. */
const MAX_MOOD_LENGTH = 200;
/** A Convex document id: lowercase letters and digits. */
const CARD_ID_PATTERN = /^[0-9a-z]{31,37}$/;

export interface ParsedSearchQuery {
  /** True with `is:archived`: archived cards (or archived cards in Trash). */
  archived: boolean;
  /** The query written the one way every surface writes it. */
  canonical: string;
  /** True with `is:fav`. */
  favorite: boolean;
  /** `folder:` names, trimmed and lowercased like a folder's name key. */
  folders: string[];
  /** Quoted phrases, matched as written (ignoring case) in a card's text. */
  phrases: string[];
  /** Every qualifier, deduplicated, in the order typed. */
  qualifiers: SearchQualifier[];
  /** `like:` or `mood:`, when the search has one. */
  similarity?: SearchSimilarity | null;
  /** `site:` hosts, normalized. */
  sites: string[];
  /** `tag:` and `#tag` values, lowercased. */
  tags: string[];
  /** Plain words, as typed (hex colors like `#fff` stay words). */
  terms: string[];
  /** The words to give the full-text index: plain words and phrase words. */
  text: string;
  /** `type:` card types. */
  types: CardType[];
}

const QUOTE_CHARACTERS = new Set(['"', "“", "”"]);

const FAVORITE_WORDS = new Set([
  "fav",
  "favs",
  "favorite",
  "favorites",
  "favourite",
  "favourites",
  "starred",
]);
const ARCHIVED_WORDS = new Set(["archived", "archive"]);

interface RawToken {
  /** The text before the first quote ("folder:" in `folder:"Reading"`). */
  prefix: string;
  quoted: boolean;
  /** The token with its quotes removed. */
  text: string;
}

/**
 * Splits on whitespace outside quotes. A quote runs to the next quote (or
 * the end, when unbalanced); inside quotes, a backslash makes the next quote
 * or backslash literal.
 */
const tokenize = (input: string): RawToken[] => {
  const tokens: RawToken[] = [];
  let index = 0;
  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index] ?? "")) {
      index += 1;
    }
    if (index >= input.length) {
      break;
    }
    let text = "";
    let prefix: string | null = null;
    let inQuotes = false;
    while (index < input.length) {
      const character = input[index] ?? "";
      if (inQuotes) {
        const next = input[index + 1] ?? "";
        if (
          character === "\\" &&
          (QUOTE_CHARACTERS.has(next) || next === "\\")
        ) {
          text += input[index + 1];
          index += 2;
          continue;
        }
        if (QUOTE_CHARACTERS.has(character)) {
          inQuotes = false;
          index += 1;
          continue;
        }
        text += character;
        index += 1;
        continue;
      }
      if (/\s/.test(character)) {
        break;
      }
      if (QUOTE_CHARACTERS.has(character)) {
        if (prefix === null) {
          prefix = text;
        }
        inQuotes = true;
        index += 1;
        continue;
      }
      text += character;
      index += 1;
    }
    tokens.push({ prefix: prefix ?? "", quoted: prefix !== null, text });
  }
  return tokens;
};

/** Trims edge punctuation, except the characters in `keep`. */
const trimEdgePunctuation = (value: string, keep = ""): string => {
  const trims = (character: string) =>
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(character) &&
    !keep.includes(character);
  let start = 0;
  let end = value.length;
  while (start < end && trims(value[start] ?? "")) {
    start += 1;
  }
  while (end > start && trims(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(start, end);
};

const parseType = (value: string): CardType | null => {
  const word = value.trim().toLowerCase();
  const known = cardTypes as readonly string[];
  if (known.includes(word)) {
    return word as CardType;
  }
  if (word.endsWith("s") && known.includes(word.slice(0, -1))) {
    return word.slice(0, -1) as CardType;
  }
  return null;
};

const parseQualifier = (
  key: SearchQualifierKey,
  rawValue: string
): SearchQualifier | null => {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }
  switch (key) {
    case "tag": {
      const tag = tagKey(value);
      return tag && tag.length <= MAX_TAG_KEY_LENGTH
        ? { key, value: tag }
        : null;
    }
    case "type": {
      const type = parseType(value);
      return type ? { key, value: type } : null;
    }
    case "is": {
      const word = value.toLowerCase();
      if (FAVORITE_WORDS.has(word)) {
        return { key, value: "fav" };
      }
      return ARCHIVED_WORDS.has(word) ? { key, value: "archived" } : null;
    }
    case "site": {
      const host = normalizeUrlHost(value);
      return host ? { key, value: host } : null;
    }
    case "folder":
      return { key, value };
    case "like":
      return CARD_ID_PATTERN.test(value) ? { key, value } : null;
    case "mood": {
      const text = value.replace(/\s+/g, " ").slice(0, MAX_MOOD_LENGTH).trim();
      return text ? { key, value: text } : null;
    }
    default:
      return null;
  }
};

const isSimilarityKey = (key: SearchQualifierKey) =>
  key === "like" || key === "mood";

const qualifierIdentity = (qualifier: SearchQualifier): string =>
  `${qualifier.key}:${
    qualifier.key === "folder" ? qualifier.value.toLowerCase() : qualifier.value
  }`;

// Quotes keep spaces, quote characters, backslashes, and the edge
// punctuation an unquoted value loses (`Ideas!`, `.net`).
const needsQuotes = (value: string) =>
  /[\s"“”\\]/.test(value) ||
  SEARCH_TOKEN_TRIM_CHARACTERS.includes(value[0] ?? "") ||
  SEARCH_TOKEN_TRIM_CHARACTERS.includes(value[value.length - 1] ?? "");

/**
 * A value in quotes, escaped so the tokenizer reads it back exactly:
 * backslashes and every quote character get a backslash.
 */
export const quoteSearchValue = (value: string) =>
  `"${value.replace(/[\\"“”]/g, (character) => `\\${character}`)}"`;

/** A qualifier written as it is typed, quoting values with spaces. */
export const formatSearchQualifier = (qualifier: SearchQualifier): string => {
  const value =
    qualifier.key === "site"
      ? hostForDisplay(qualifier.value)
      : qualifier.value;
  return `${qualifier.key}:${needsQuotes(value) ? quoteSearchValue(value) : value}`;
};

/**
 * Reads a search: qualifiers (`tag:`, `#tag`, `type:`, `is:fav`,
 * `is:archived`, `site:`, `folder:`, `like:<card id>`, `mood:"…"`), quoted
 * phrases and plain words. Keys
 * ignore case and take quoted values (`folder:"Reading list"`). A value a
 * key cannot use, an unknown key and a valid hex color after `#` stay plain
 * words. Every surface reads searches with this one parser.
 */
export const parseSearchQuery = (input: string): ParsedSearchQuery => {
  const qualifiers: SearchQualifier[] = [];
  const seen = new Set<string>();
  const terms: string[] = [];
  const phrases: string[] = [];
  const addQualifier = (qualifier: SearchQualifier) => {
    const identity = qualifierIdentity(qualifier);
    if (!seen.has(identity)) {
      seen.add(identity);
      qualifiers.push(qualifier);
    }
  };

  for (const token of tokenize(input)) {
    const colon = token.quoted
      ? token.prefix.indexOf(":")
      : token.text.indexOf(":");
    const keyCandidate =
      colon > 0 ? token.text.slice(0, colon).toLowerCase() : "";
    if (
      colon > 0 &&
      (!token.quoted || colon === token.prefix.length - 1) &&
      (SEARCH_QUALIFIER_KEYS as readonly string[]).includes(keyCandidate)
    ) {
      const key = keyCandidate as SearchQualifierKey;
      const rawValue = token.text.slice(colon + 1);
      const qualifier = parseQualifier(
        key,
        token.quoted
          ? rawValue
          : // An IPv6 host keeps its brackets: `site:[::1]`.
            trimEdgePunctuation(rawValue, key === "site" ? "[]" : "")
      );
      if (
        qualifier &&
        isSimilarityKey(qualifier.key) &&
        qualifiers.some(
          (other) =>
            isSimilarityKey(other.key) &&
            qualifierIdentity(other) !== qualifierIdentity(qualifier)
        )
      ) {
        // One anchor per search: a second one is just text.
        terms.push(token.text);
      } else if (qualifier) {
        addQualifier(qualifier);
      } else if (rawValue.trim()) {
        // A value the key cannot use ("type:banana") is searched as text.
        terms.push(token.text);
      }
      continue;
    }

    if (token.text.startsWith("#") && (!token.quoted || token.prefix === "#")) {
      const value = token.quoted
        ? token.text.slice(1)
        : trimEdgePunctuation(token.text.slice(1));
      // A hex color wins: `#fff` is a color, `tag:fff` the tag.
      if (!token.quoted && value && normalizeHexColor(`#${value}`)) {
        terms.push(token.text);
        continue;
      }
      const qualifier = parseQualifier("tag", value);
      if (qualifier) {
        addQualifier(qualifier);
      }
      continue;
    }

    if (token.quoted && token.prefix === "") {
      const phrase = token.text.trim();
      if (phrase) {
        phrases.push(phrase);
      }
      continue;
    }

    if (token.text.trim()) {
      terms.push(token.text);
    }
  }

  const tags: string[] = [];
  const types: CardType[] = [];
  const sites: string[] = [];
  const folders: string[] = [];
  const is = new Set<SearchIsValue>();
  let similarity: SearchSimilarity | null = null;
  for (const qualifier of qualifiers) {
    if (qualifier.key === "tag") {
      tags.push(qualifier.value);
    } else if (qualifier.key === "type") {
      types.push(qualifier.value);
    } else if (qualifier.key === "site") {
      sites.push(qualifier.value);
    } else if (qualifier.key === "folder") {
      folders.push(qualifier.value.trim().toLowerCase());
    } else if (qualifier.key === "like") {
      similarity = { kind: "like", cardId: qualifier.value };
    } else if (qualifier.key === "mood") {
      similarity = { kind: "mood", text: qualifier.value };
    } else {
      is.add(qualifier.value);
    }
  }

  const canonical = [
    ...qualifiers.map(formatSearchQualifier),
    ...phrases.map(quoteSearchValue),
    ...terms,
  ].join(" ");

  return {
    qualifiers,
    terms,
    phrases,
    text: [...terms, ...phrases].join(" ").trim(),
    tags,
    types,
    favorite: is.has("fav"),
    archived: is.has("archived"),
    sites,
    folders,
    similarity,
    canonical,
  };
};

/**
 * One search that matches what both `scope` and `typed` match, written the
 * canonical way, or null when nothing can match both. Within one search
 * `type:` and `site:` match any of their values, so across the two they
 * intersect; tags, folders, phrases, words and `is:` add up. A smart
 * folder's stored query is the scope and the search box's text is typed.
 */
export const combineSearchQueries = (
  scope: string,
  typed: string
): string | null => {
  const outer = parseSearchQuery(scope);
  const inner = parseSearchQuery(typed);
  // One anchor per search: two different ones can never both match.
  if (
    outer.similarity &&
    inner.similarity &&
    JSON.stringify(outer.similarity) !== JSON.stringify(inner.similarity)
  ) {
    return null;
  }
  const intersect = <T>(left: T[], right: T[]) => {
    if (left.length === 0) {
      return right;
    }
    if (right.length === 0) {
      return left;
    }
    return left.filter((value) => right.includes(value));
  };
  const types = intersect(outer.types, inner.types);
  const sites = intersect(outer.sites, inner.sites);
  if (
    (outer.types.length > 0 && inner.types.length > 0 && types.length === 0) ||
    (outer.sites.length > 0 && inner.sites.length > 0 && sites.length === 0)
  ) {
    return null;
  }
  const narrowed = (qualifier: SearchQualifier) =>
    qualifier.key === "type" || qualifier.key === "site";
  const qualifiers: SearchQualifier[] = [
    ...outer.qualifiers.filter((qualifier) => !narrowed(qualifier)),
    ...inner.qualifiers.filter((qualifier) => !narrowed(qualifier)),
    ...types.map((value) => ({ key: "type" as const, value })),
    ...sites.map((value) => ({ key: "site" as const, value })),
  ];
  // Read back once more so a qualifier in both is written once.
  return parseSearchQuery(
    [
      ...qualifiers.map(formatSearchQualifier),
      ...[...outer.phrases, ...inner.phrases].map(quoteSearchValue),
      ...outer.terms,
      ...inner.terms,
    ].join(" ")
  ).canonical;
};

/**
 * The search with every `folder:` naming `fromNameKey` (a folder's name
 * key) renamed to `toName`, written the canonical way; unchanged when it
 * names no such folder. Keeps smart folders pointing at a renamed folder.
 */
export const renameFolderInSearchQuery = (
  query: string,
  fromNameKey: string,
  toName: string
): string => {
  const parsed = parseSearchQuery(query);
  if (!parsed.folders.includes(fromNameKey)) {
    return query;
  }
  const qualifiers = parsed.qualifiers.map((qualifier) =>
    qualifier.key === "folder" &&
    qualifier.value.trim().toLowerCase() === fromNameKey
      ? { key: "folder" as const, value: toName }
      : qualifier
  );
  return parseSearchQuery(
    [
      ...qualifiers.map(formatSearchQualifier),
      ...parsed.phrases.map(quoteSearchValue),
      ...parsed.terms,
    ].join(" ")
  ).canonical;
};

/** Whether a search uses any qualifier. */
export const hasSearchQualifiers = (parsed: ParsedSearchQuery) =>
  parsed.qualifiers.length > 0;

/** Whether a card's text contains every quoted phrase (ignoring case). */
export const matchesSearchPhrases = (
  searchableText: string,
  phrases: readonly string[]
) => {
  if (phrases.length === 0) {
    return true;
  }
  const text = searchableText.toLowerCase();
  return phrases.every((phrase) => text.includes(phrase.toLowerCase()));
};
