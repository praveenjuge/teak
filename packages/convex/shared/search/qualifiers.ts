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
  | { key: "folder"; value: string };

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

const trimEdgePunctuation = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (
    start < end &&
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(value[start] ?? "")
  ) {
    start += 1;
  }
  while (
    end > start &&
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(value[end - 1] ?? "")
  ) {
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
    default:
      return null;
  }
};

const qualifierIdentity = (qualifier: SearchQualifier): string =>
  `${qualifier.key}:${
    qualifier.key === "folder" ? qualifier.value.toLowerCase() : qualifier.value
  }`;

const needsQuotes = (value: string) => /[\s"“”\\]/.test(value);

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
 * `is:archived`, `site:`, `folder:`), quoted phrases and plain words. Keys
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
        token.quoted ? rawValue : trimEdgePunctuation(rawValue)
      );
      if (qualifier) {
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
  for (const qualifier of qualifiers) {
    if (qualifier.key === "tag") {
      tags.push(qualifier.value);
    } else if (qualifier.key === "type") {
      types.push(qualifier.value);
    } else if (qualifier.key === "site") {
      sites.push(qualifier.value);
    } else if (qualifier.key === "folder") {
      folders.push(qualifier.value.trim().toLowerCase());
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
    canonical,
  };
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
