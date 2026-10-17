import { type CardType, cardTypes } from "../constants";
import { ACTIONABLE_LINK_CATEGORIES } from "../linkCategories";
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
  "price",
  "text",
] as const;
export type SearchQualifierKey = (typeof SEARCH_QUALIFIER_KEYS)[number];

export type SearchIsValue = "fav" | "archived" | "done" | "todo";

export type PriceComparison = "<" | ">" | "<=" | ">=" | "=";

/** A `price:` bound, as in `price:<100`: compared with a card's amount. */
export interface PriceBound {
  amount: number;
  op: PriceComparison;
}

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
  | { key: "mood"; value: string }
  /** The bound written the canonical way: `<100`, `>=9.99`. */
  | { key: "price"; value: string }
  /** Words that must appear in the text read from an image, as typed. */
  | { key: "text"; value: string };

/** What a search finds by meaning instead of by its words (one at most). */
export type SearchSimilarity =
  | { kind: "like"; cardId: string }
  | { kind: "mood"; text: string };

/** Longest `mood:` text kept. */
const MAX_MOOD_LENGTH = 200;
/** Longest `text:` value kept. */
const MAX_OCR_TEXT_LENGTH = 200;
/** A Convex document id: lowercase letters and digits. */
const CARD_ID_PATTERN = /^[0-9a-z]{31,37}$/;

export interface ParsedSearchQuery {
  /** True with `is:archived`: archived cards (or archived cards in Trash). */
  archived: boolean;
  /** The query written the one way every surface writes it. */
  canonical: string;
  /** True with `is:done`: cards marked read, watched, bought or done. */
  done: boolean;
  /** True with `is:fav`. */
  favorite: boolean;
  /** `folder:` names, trimmed and lowercased like a folder's name key. */
  folders: string[];
  /** `text:` values, as typed: each must appear in a card's image text. */
  ocrTexts: string[];
  /** Quoted phrases, matched as written (ignoring case) in a card's text. */
  phrases: string[];
  /** `price:` bounds; a card's amount must meet every one. */
  prices: PriceBound[];
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
  /**
   * True with `is:todo`: links in a category worth finishing (a book, a
   * film, a product) that aren't done yet.
   */
  todo: boolean;
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
const DONE_WORDS = new Set(["done", "completed", "finished"]);
const TODO_WORDS = new Set(["todo", "to-do"]);

interface RawToken {
  prefix: string;
  quoted: boolean;
  text: string;
}

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

const PRICE_BOUND_PATTERN = /^(<=|>=|<|>|=)(\d{1,12}(?:\.\d{1,6})?)$/;

/**
 * A `price:` value: `<N`, `>N`, `<=N`, `>=N` or `=N` with a plain decimal
 * amount. Null for anything else (`abc`, `<`, `<1e9`, `<-5`).
 */
export const parsePriceBound = (value: string): PriceBound | null => {
  const match = PRICE_BOUND_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number(match[2]);
  return Number.isFinite(amount)
    ? { op: match[1] as PriceComparison, amount }
    : null;
};

/** A bound written the canonical way: `<100`, `>=9.99`. */
export const formatPriceBound = (bound: PriceBound): string =>
  `${bound.op}${bound.amount}`;

/** Whether an amount meets a bound. */
export const priceMeetsBound = (amount: number, bound: PriceBound) => {
  switch (bound.op) {
    case "<":
      return amount < bound.amount;
    case ">":
      return amount > bound.amount;
    case "<=":
      return amount <= bound.amount;
    case ">=":
      return amount >= bound.amount;
    default:
      return amount === bound.amount;
  }
};

/**
 * Whether a card's price meets every bound. A card without a price never
 * does when there is a bound.
 */
export const matchesPriceBounds = (
  amount: number | null | undefined,
  bounds: readonly PriceBound[]
) =>
  bounds.length === 0 ||
  (typeof amount === "number" &&
    bounds.every((bound) => priceMeetsBound(amount, bound)));

/** A bound for people: "Under 100", "20 or more". */
export const describePriceBound = (bound: PriceBound): string => {
  const amount = bound.amount.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
  switch (bound.op) {
    case "<":
      return `Under ${amount}`;
    case ">":
      return `Over ${amount}`;
    case "<=":
      return `${amount} or less`;
    case ">=":
      return `${amount} or more`;
    default:
      return `Exactly ${amount}`;
  }
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
      if (DONE_WORDS.has(word)) {
        return { key, value: "done" };
      }
      if (TODO_WORDS.has(word)) {
        return { key, value: "todo" };
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
    case "price": {
      const bound = parsePriceBound(value);
      return bound ? { key, value: formatPriceBound(bound) } : null;
    }
    case "text": {
      const text = value.replace(/\s+/g, " ").slice(0, MAX_OCR_TEXT_LENGTH);
      return text.trim() ? { key, value: text.trim() } : null;
    }
    default:
      return null;
  }
};

const isSimilarityKey = (key: SearchQualifierKey) =>
  key === "like" || key === "mood";

// Folder names, moods and image text match whatever their case:
// `mood:Calm` and `mood:calm` are one anchor.
const qualifierIdentity = (qualifier: SearchQualifier): string =>
  `${qualifier.key}:${
    qualifier.key === "folder" ||
    qualifier.key === "mood" ||
    qualifier.key === "text"
      ? qualifier.value.toLowerCase()
      : qualifier.value
  }`;

const similarityIdentity = (similarity: SearchSimilarity) =>
  similarity.kind === "like"
    ? qualifierIdentity({ key: "like", value: similarity.cardId })
    : qualifierIdentity({ key: "mood", value: similarity.text });

const needsQuotes = (value: string) =>
  /[\s"“”\\]/.test(value) ||
  SEARCH_TOKEN_TRIM_CHARACTERS.includes(value[0] ?? "") ||
  SEARCH_TOKEN_TRIM_CHARACTERS.includes(value[value.length - 1] ?? "");

export const quoteSearchValue = (value: string) =>
  `"${value.replace(/[\\"“”]/g, (character) => `\\${character}`)}"`;

export const formatSearchQualifier = (qualifier: SearchQualifier): string => {
  const value =
    qualifier.key === "site"
      ? hostForDisplay(qualifier.value)
      : qualifier.value;
  return `${qualifier.key}:${needsQuotes(value) ? quoteSearchValue(value) : value}`;
};

/**
 * Reads a search: qualifiers (`tag:`, `#tag`, `type:`, `is:fav`,
 * `is:archived`, `is:done`, `is:todo`, `site:`, `folder:`, `price:<100`, `text:"total due"`,
 * `like:<card id>`, `mood:"…"`), quoted phrases and plain words. Keys
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
          : trimEdgePunctuation(rawValue, key === "site" ? "[]" : "")
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
        terms.push(token.text);
      }
      continue;
    }

    if (token.text.startsWith("#") && (!token.quoted || token.prefix === "#")) {
      const value = token.quoted
        ? token.text.slice(1)
        : trimEdgePunctuation(token.text.slice(1));
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
  const prices: PriceBound[] = [];
  const ocrTexts: string[] = [];
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
    } else if (qualifier.key === "price") {
      const bound = parsePriceBound(qualifier.value);
      if (bound) {
        prices.push(bound);
      }
    } else if (qualifier.key === "text") {
      ocrTexts.push(qualifier.value);
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
    ocrTexts,
    types,
    favorite: is.has("fav"),
    archived: is.has("archived"),
    done: is.has("done"),
    todo: is.has("todo"),
    sites,
    folders,
    similarity,
    prices,
    canonical,
  };
};

/**
 * One search that matches what both `scope` and `typed` match, written the
 * canonical way, or null when nothing can match both. Within one search
 * `type:` and `site:` match any of their values, so across the two they
 * intersect; tags, folders, prices, image text, phrases, words and `is:` add up, so
 * `price:>20` and `price:<100` make a range. A smart folder's stored query
 * is the scope and the search box's text is typed.
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
    similarityIdentity(outer.similarity) !==
      similarityIdentity(inner.similarity)
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

const WHITESPACE_RUNS = /\s+/g;

/**
 * `is:done`: the card is marked done. `is:todo`: it isn't, and its link
 * category is one worth finishing (a book, a film, a product).
 */
export const matchesDoneState = (
  card: {
    completedAt?: number;
    metadata?: { linkCategory?: { category?: string } };
  },
  parsed: Pick<ParsedSearchQuery, "done" | "todo">
): boolean => {
  if (parsed.done && card.completedAt === undefined) {
    return false;
  }
  if (parsed.todo) {
    const category = card.metadata?.linkCategory?.category;
    return (
      card.completedAt === undefined &&
      category !== undefined &&
      ACTIONABLE_LINK_CATEGORIES.has(category)
    );
  }
  return true;
};

/**
 * Whether a card's image text contains every `text:` value, ignoring case
 * and how the text breaks across lines.
 */
export const matchesImageText = (
  imageText: string | null | undefined,
  values: readonly string[]
) => {
  if (values.length === 0) {
    return true;
  }
  if (!imageText) {
    return false;
  }
  const text = imageText.replace(WHITESPACE_RUNS, " ").toLowerCase();
  return values.every((value) =>
    text.includes(value.replace(WHITESPACE_RUNS, " ").toLowerCase())
  );
};
