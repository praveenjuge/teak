import { type CardType, cardTypes } from "../constants";
import { ACTIONABLE_LINK_CATEGORIES } from "../linkCategories";
import { MAX_TAG_KEY_LENGTH, tagKey } from "../tags";
import { normalizeHexColor } from "../utils/colorUtils";
import { hostForDisplay, normalizeUrlHost } from "../utils/urlHost";
import { SEARCH_TOKEN_TRIM_CHARACTERS } from "./constants";

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

export interface PriceBound {
  amount: number;
  op: PriceComparison;
}

export type SearchQualifier =
  | { key: "tag"; value: string }
  | { key: "type"; value: CardType }
  | { key: "is"; value: SearchIsValue }
  | { key: "site"; value: string }
  | { key: "folder"; value: string }
  | { key: "like"; value: string }
  | { key: "mood"; value: string }
  | { key: "price"; value: string }
  | { key: "text"; value: string };

export type SearchSimilarity =
  | { kind: "like"; cardId: string }
  | { kind: "mood"; text: string };

const MAX_MOOD_LENGTH = 200;
const MAX_OCR_TEXT_LENGTH = 200;
const CONVEX_ID_PATTERN = /^[0-9a-z]{31,37}$/;

/**
 * A search's boolean structure. `-` is `not`, uppercase `OR` is `or`, a
 * space is `and`, and parentheses group.
 */
export type SearchExpression =
  | { op: "and" | "or"; items: SearchExpression[] }
  | { op: "not"; item: SearchExpression }
  | { op: "term"; value: string }
  | { op: "phrase"; value: string }
  | { op: "qualifier"; qualifier: SearchQualifier };

/** Parentheses nest at most this deep; deeper ones are ignored. */
export const MAX_SEARCH_EXPRESSION_DEPTH = 4;
/** Past this many words and filters, the rest is searched as plain words. */
export const MAX_SEARCH_EXPRESSION_LEAVES = 64;

export interface ParsedSearchQuery {
  archived: boolean;
  canonical: string;
  done: boolean;
  /**
   * The parts the flat fields can't hold: exclusions, `OR` and groups, all
   * of which must also match. Undefined when the query has none, so a query
   * without operators behaves exactly as the flat fields say.
   */
  expression?: SearchExpression;
  favorite: boolean;
  folders: string[];
  ocrTexts: string[];
  phrases: string[];
  prices: PriceBound[];
  qualifiers: SearchQualifier[];
  similarity?: SearchSimilarity | null;
  sites: string[];
  tags: string[];
  terms: string[];
  text: string;
  todo: boolean;
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
  /** `-` before the token, outside quotes: the token is excluded. */
  negated: boolean;
  paren?: "(" | ")";
  prefix: string;
  quoted: boolean;
  text: string;
}

const isParen = (character: string) => character === "(" || character === ")";

/** Whether `input` from `index` to the next space holds only parentheses. */
const onlyParensUntilSpace = (input: string, index: number) => {
  for (let at = index; at < input.length; at += 1) {
    const character = input[at] ?? "";
    if (/\s/.test(character)) {
      return true;
    }
    if (!isParen(character)) {
      return false;
    }
  }
  return true;
};

/**
 * Splits a query into words, honouring straight and curly quotes and `\`
 * escapes inside them. Outside quotes, parentheses at a word's start or end
 * are their own tokens, and a `-` that starts a word marks it excluded.
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
    let negated = false;
    // A word's start: its `-` and any opening or stray closing parentheses.
    while (index < input.length) {
      const character = input[index] ?? "";
      const next = input[index + 1] ?? "";
      if (!negated && character === "-" && next && !/\s/.test(next)) {
        negated = true;
        index += 1;
        continue;
      }
      if (isParen(character)) {
        tokens.push({
          negated: negated && character === "(",
          paren: character,
          prefix: "",
          quoted: false,
          text: character,
        });
        negated = false;
        index += 1;
        continue;
      }
      break;
    }
    if (index >= input.length || /\s/.test(input[index] ?? "")) {
      continue;
    }
    let text = "";
    let prefix: string | null = null;
    let inQuotes = false;
    const closing: RawToken[] = [];
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
      if (isParen(character) && onlyParensUntilSpace(input, index)) {
        while (index < input.length && isParen(input[index] ?? "")) {
          const paren = input[index] as "(" | ")";
          closing.push({
            negated: false,
            paren,
            prefix: "",
            quoted: false,
            text: paren,
          });
          index += 1;
        }
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
    tokens.push({
      negated,
      prefix: prefix ?? "",
      quoted: prefix !== null,
      text,
    });
    tokens.push(...closing);
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

export const formatPriceBound = (bound: PriceBound): string =>
  `${bound.op}${bound.amount}`;

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

export const matchesPriceBounds = (
  amount: number | null | undefined,
  bounds: readonly PriceBound[]
) =>
  bounds.length === 0 ||
  (typeof amount === "number" &&
    bounds.every((bound) => priceMeetsBound(amount, bound)));

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
      return CONVEX_ID_PATTERN.test(value) ? { key, value } : null;
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

/** One word of a query as a leaf: a filter, a tag, a phrase or a word. */
const leafOf = (token: RawToken): SearchExpression | null => {
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
    if (qualifier) {
      return { op: "qualifier", qualifier };
    }
    return rawValue.trim() ? { op: "term", value: token.text } : null;
  }

  if (token.text.startsWith("#") && (!token.quoted || token.prefix === "#")) {
    const value = token.quoted
      ? token.text.slice(1)
      : trimEdgePunctuation(token.text.slice(1));
    if (!token.quoted && value && normalizeHexColor(`#${value}`)) {
      return { op: "term", value: token.text };
    }
    const qualifier = parseQualifier("tag", value);
    return qualifier ? { op: "qualifier", qualifier } : null;
  }

  if (token.quoted && token.prefix === "") {
    const phrase = token.text.trim();
    return phrase ? { op: "phrase", value: phrase } : null;
  }

  return token.text.trim() ? { op: "term", value: token.text } : null;
};

/** The words a token stands for when it is read as plain text. */
const tokenText = (token: RawToken) =>
  token.paren
    ? ""
    : `${token.negated ? "-" : ""}${
        token.quoted
          ? `${token.prefix}${quoteSearchValue(token.text.slice(token.prefix.length))}`
          : token.text
      }`;

const isOrToken = (token: RawToken | undefined) =>
  token !== undefined &&
  !token.quoted &&
  !token.negated &&
  !token.paren &&
  token.text === "OR";

const isSimilarityLeaf = (expression: SearchExpression) =>
  expression.op === "qualifier" && isSimilarityKey(expression.qualifier.key);

/** Joins items under one operator, flattening same-operator children. */
const joinExpressions = (
  op: "and" | "or",
  items: SearchExpression[]
): SearchExpression | null => {
  const flat = items.flatMap((item) => (item.op === op ? item.items : [item]));
  if (flat.length === 0) {
    return null;
  }
  return flat.length === 1 ? (flat[0] ?? null) : { op, items: flat };
};

/**
 * Reads tokens into an expression: `OR` binds loosest, then a space, then
 * `-`; parentheses group. It never throws: a lone `-` or `OR`, a stray `)`
 * and an unclosed `(` are forgiven, `like:` and `mood:` count only outside
 * groups and exclusions, and past the depth and leaf caps the rest is read
 * as plain words.
 */
const parseSearchTree = (input: string): SearchExpression | null => {
  const tokens = tokenize(input).filter(
    (token) => token.paren || token.quoted || token.text !== "-"
  );
  let position = 0;
  let leaves = 0;
  // Opening parentheses past the depth cap, whose `)` closes nothing.
  let ignoredOpens = 0;
  const overflow: SearchExpression[] = [];

  const readLeaf = (token: RawToken) => {
    const leaf = leafOf(token);
    if (!leaf) {
      return null;
    }
    if (leaves >= MAX_SEARCH_EXPRESSION_LEAVES) {
      overflow.push({ op: "term", value: tokenText(token) });
      return null;
    }
    leaves += 1;
    // Similarity picks the ranking, so it can't be excluded.
    if (isSimilarityLeaf(leaf) && token.negated) {
      return { op: "term", value: tokenText(token) } as SearchExpression;
    }
    return token.negated
      ? ({ op: "not", item: leaf } as SearchExpression)
      : leaf;
  };

  const parseOr = (depth: number): SearchExpression | null => {
    const items: SearchExpression[] = [];
    const first = parseAnd(depth);
    if (first) {
      items.push(first);
    }
    while (isOrToken(tokens[position])) {
      position += 1;
      const next = parseAnd(depth);
      if (next) {
        items.push(next);
      }
    }
    return joinExpressions("or", items);
  };

  const parseAnd = (depth: number): SearchExpression | null => {
    const items: SearchExpression[] = [];
    while (position < tokens.length) {
      const token = tokens[position];
      if (!token || isOrToken(token)) {
        break;
      }
      if (token.paren === ")") {
        if (ignoredOpens > 0) {
          ignoredOpens -= 1;
          position += 1;
          continue;
        }
        if (depth > 0) {
          break;
        }
        position += 1;
        continue;
      }
      position += 1;
      if (token.paren === "(") {
        if (depth >= MAX_SEARCH_EXPRESSION_DEPTH) {
          ignoredOpens += 1;
          continue;
        }
        const group = parseOr(depth + 1);
        if (tokens[position]?.paren === ")") {
          position += 1;
        }
        if (group) {
          items.push(token.negated ? { op: "not", item: group } : group);
        }
        continue;
      }
      const leaf = readLeaf(token);
      if (leaf) {
        items.push(leaf);
      }
    }
    return joinExpressions("and", items);
  };

  const root = parseOr(0);
  const joined = joinExpressions("and", [...(root ? [root] : []), ...overflow]);
  if (!joined) {
    return null;
  }
  // Similarity picks the ranking, so it counts only as a top-level filter;
  // inside a group or an OR it is a plain word.
  const topLevel = joined.op === "and" ? joined.items : [joined];
  const demoted = topLevel.map((item) =>
    item.op === "qualifier" ? item : demoteSimilarity(item)
  );
  return joined.op === "and"
    ? { op: "and", items: demoted }
    : (demoted[0] ?? null);
};

const demoteSimilarity = (expression: SearchExpression): SearchExpression => {
  switch (expression.op) {
    case "qualifier":
      return isSimilarityLeaf(expression)
        ? { op: "term", value: formatSearchQualifier(expression.qualifier) }
        : expression;
    case "not":
      return { op: "not", item: demoteSimilarity(expression.item) };
    case "and":
    case "or":
      return {
        op: expression.op,
        items: expression.items.map(demoteSimilarity),
      };
    default:
      return expression;
  }
};

/** A word is printed as written, except one that would read as `OR`. */
const formatTerm = (value: string) =>
  value === "OR" ? quoteSearchValue(value) : value;

const OPERATOR_PRECEDENCE = { or: 0, and: 1 } as const;

const formatExpression = (
  expression: SearchExpression,
  parent: "and" | "or" | "not" | null
): string => {
  switch (expression.op) {
    case "term":
      return formatTerm(expression.value);
    case "phrase":
      return quoteSearchValue(expression.value);
    case "qualifier":
      return formatSearchQualifier(expression.qualifier);
    case "not": {
      const inner = formatExpression(expression.item, "not");
      // `--x` would read as the word `-x`, so a minus before a minus groups.
      return expression.item.op === "not" ? `-(${inner})` : `-${inner}`;
    }
    default: {
      const text = expression.items
        .map((item) => formatExpression(item, expression.op))
        .join(expression.op === "or" ? " OR " : " ");
      const needsGroup =
        parent === "not" ||
        (parent !== null &&
          OPERATOR_PRECEDENCE[expression.op] < OPERATOR_PRECEDENCE[parent]);
      return needsGroup ? `(${text})` : text;
    }
  }
};

/** Prints an expression so that parsing the text gives it back. */
export const formatSearchExpression = (expression: SearchExpression): string =>
  formatExpression(expression, null);

/** Whether every card an expression matches has one of its words. */
const requiresWords = (expression: SearchExpression): boolean => {
  switch (expression.op) {
    case "term":
    case "phrase":
      return true;
    case "and":
      return expression.items.some(requiresWords);
    case "or":
      return expression.items.every(requiresWords);
    default:
      return false;
  }
};

const buildParsedQuery = (root: SearchExpression | null): ParsedSearchQuery => {
  const qualifiers: SearchQualifier[] = [];
  const seen = new Set<string>();
  const terms: string[] = [];
  const phrases: string[] = [];
  const residual: SearchExpression[] = [];
  const indexWords: string[] = [];
  const addQualifier = (qualifier: SearchQualifier) => {
    const identity = qualifierIdentity(qualifier);
    if (!seen.has(identity)) {
      seen.add(identity);
      qualifiers.push(qualifier);
    }
  };
  const collectIndexWords = (expression: SearchExpression) => {
    if (expression.op === "term" || expression.op === "phrase") {
      indexWords.push(expression.value);
    } else if (expression.op === "and" || expression.op === "or") {
      for (const item of expression.items) {
        collectIndexWords(item);
      }
    }
  };

  let items: SearchExpression[] = [];
  if (root) {
    items = root.op === "and" ? root.items : [root];
  }
  for (const item of items) {
    if (item.op === "term") {
      terms.push(item.value);
    } else if (item.op === "phrase") {
      phrases.push(item.value);
    } else if (item.op === "qualifier") {
      const { qualifier } = item;
      if (
        isSimilarityKey(qualifier.key) &&
        qualifiers.some(
          (other) =>
            isSimilarityKey(other.key) &&
            qualifierIdentity(other) !== qualifierIdentity(qualifier)
        )
      ) {
        terms.push(formatSearchQualifier(qualifier));
      } else {
        addQualifier(qualifier);
      }
    } else {
      residual.push(item);
      collectIndexWords(item);
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

  const expression = joinExpressions("and", residual) ?? undefined;
  // The search index finds cards with any of the words it gets. Top-level
  // words find every match, as they do without operators, so only a query
  // without them sends the words of its groups, and only when every match
  // has one: a card can match `is:archived OR notes` with neither. A
  // `like:` or `mood:` search reads no index, and its words must all match.
  const indexed =
    !similarity &&
    terms.length === 0 &&
    phrases.length === 0 &&
    expression !== undefined &&
    requiresWords(expression);
  const flat = [
    ...qualifiers.map(formatSearchQualifier),
    ...phrases.map(quoteSearchValue),
    ...terms.map(formatTerm),
  ];
  const canonical = [
    ...flat,
    ...residual.map((item) =>
      formatExpression(
        item,
        flat.length > 0 || residual.length > 1 ? "and" : null
      )
    ),
  ].join(" ");

  return {
    qualifiers,
    terms,
    phrases,
    text: [...terms, ...phrases, ...(indexed ? indexWords : [])]
      .join(" ")
      .trim(),
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
    ...(expression ? { expression } : {}),
  };
};

export const parseSearchQuery = (input: string): ParsedSearchQuery =>
  buildParsedQuery(parseSearchTree(input));

/** The residual parts of a parsed query, each as its own top-level item. */
const residualItems = (parsed: ParsedSearchQuery): SearchExpression[] => {
  if (!parsed.expression) {
    return [];
  }
  return parsed.expression.op === "and"
    ? parsed.expression.items
    : [parsed.expression];
};

/**
 * The parts of a query's expression, each printed to sit beside the query's
 * other words and filters: `-figma`, `(a OR b)`.
 */
export const searchExpressionParts = (parsed: ParsedSearchQuery): string[] =>
  residualItems(parsed).map((item) => formatExpression(item, "and"));

export const combineSearchQueries = (
  scope: string,
  typed: string
): string | null => {
  const outer = parseSearchQuery(scope);
  const inner = parseSearchQuery(typed);
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
  // Each side's exclusions and OR groups stay whole, so an OR in the
  // folder's query can't take in the typed words, or the other way round.
  return parseSearchQuery(
    [
      ...qualifiers.map(formatSearchQualifier),
      ...[...outer.phrases, ...inner.phrases].map(quoteSearchValue),
      ...outer.terms,
      ...inner.terms,
      ...[...residualItems(outer), ...residualItems(inner)].map((item) =>
        formatExpression(item, "and")
      ),
    ].join(" ")
  ).canonical;
};

const renameFolderLeaves = (
  expression: SearchExpression,
  fromNameKey: string,
  toName: string
): SearchExpression => {
  switch (expression.op) {
    case "qualifier":
      return expression.qualifier.key === "folder" &&
        expression.qualifier.value.trim().toLowerCase() === fromNameKey
        ? { op: "qualifier", qualifier: { key: "folder", value: toName } }
        : expression;
    case "not":
      return {
        op: "not",
        item: renameFolderLeaves(expression.item, fromNameKey, toName),
      };
    case "and":
    case "or":
      return {
        op: expression.op,
        items: expression.items.map((item) =>
          renameFolderLeaves(item, fromNameKey, toName)
        ),
      };
    default:
      return expression;
  }
};

/** Every filter a query names, wherever it sits in the expression. */
export const searchExpressionQualifiers = (
  expression: SearchExpression | undefined
): SearchQualifier[] => {
  if (!expression) {
    return [];
  }
  switch (expression.op) {
    case "qualifier":
      return [expression.qualifier];
    case "not":
      return searchExpressionQualifiers(expression.item);
    case "and":
    case "or":
      return expression.items.flatMap(searchExpressionQualifiers);
    default:
      return [];
  }
};

export const renameFolderInSearchQuery = (
  query: string,
  fromNameKey: string,
  toName: string
): string => {
  const parsed = parseSearchQuery(query);
  const named = [
    ...parsed.folders,
    ...searchExpressionQualifiers(parsed.expression)
      .filter((qualifier) => qualifier.key === "folder")
      .map((qualifier) => qualifier.value.trim().toLowerCase()),
  ];
  if (!named.includes(fromNameKey)) {
    return query;
  }
  const root = parseSearchTree(query);
  return root
    ? parseSearchQuery(
        formatSearchExpression(renameFolderLeaves(root, fromNameKey, toName))
      ).canonical
    : query;
};

export const hasSearchQualifiers = (parsed: ParsedSearchQuery) =>
  parsed.qualifiers.length > 0;

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
