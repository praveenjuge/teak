import {
  describePriceBound,
  formatSearchExpression,
  formatSearchQualifier,
  hostForDisplay,
  parsePriceBound,
  parseSearchQuery,
  type SearchQualifier,
  type SearchQualifierKey,
} from "@teak/convex/shared";
import {
  CARD_TYPE_LABELS,
  type CardType,
  cardTypes,
} from "@teak/convex/shared/constants";
import { isHiddenTagList } from "@teak/convex/shared/tags";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";

type SearchTranslator = TeakTranslator<"search">;

const englishSearch = createTeakTranslator("en", englishMessages, "search");

export interface SearchSuggestionSources {
  folders?: readonly { name: string }[];
  sites?: readonly { count: number; host: string; label: string }[];
  tags?: readonly { count: number; name: string }[];
}

export type SearchSuggestionGroup =
  | "Combine"
  | "Exclude"
  | "Filters"
  | "Tags"
  | "Types"
  | "Folders"
  | "Sites"
  | "Show";

const GROUP_MESSAGE_KEYS = {
  Combine: "combine",
  Exclude: "exclude",
  Filters: "filters",
  Tags: "tags",
  Types: "types",
  Folders: "folders",
  Sites: "sites",
  Show: "show",
} as const satisfies Record<SearchSuggestionGroup, string>;

/** A suggestion group's heading in the UI language. */
export const searchSuggestionGroupLabel = (
  group: SearchSuggestionGroup,
  t: SearchTranslator = englishSearch
): string => t(`suggestions.groups.${GROUP_MESSAGE_KEYS[group]}`);

export interface SearchSuggestion {
  complete: boolean;
  detail?: string;
  group: SearchSuggestionGroup;
  id: string;
  insert: string;
  /** The qualifier it inserts, or `OR`. */
  key: SearchQualifierKey | "OR";
  label: string;
  type?: CardType;
}

export interface SearchSuggestionResult {
  completingValue: boolean;
  suggestions: SearchSuggestion[];
}

export const SEARCH_SUGGESTION_GROUP_LIMIT = 8;
const WORD_GROUP_LIMIT = 4;

// Qualifier keys are search syntax and stay English; their hints are
// translated.
const QUALIFIER_HINTS = [
  "tag",
  "type",
  "site",
  "folder",
  "is",
  "mood",
  "price",
  "text",
] as const satisfies readonly SearchQualifierKey[];

/** The filters a `-` can leave out; `like:` and `mood:` can't be excluded. */
const EXCLUDE_HINTS = [
  "tag",
  "type",
  "site",
  "folder",
  "is",
] as const satisfies readonly SearchQualifierKey[];

const orSuggestion = (t: SearchTranslator): SearchSuggestion => ({
  complete: false,
  detail: t("suggestions.orDetail"),
  group: "Combine",
  id: "Combine:OR",
  insert: "OR ",
  key: "OR",
  label: "OR",
});

// `words` are what people type after `is:`, so they stay English.
const IS_OPTIONS = [
  { value: "fav", words: ["fav", "favorites", "starred"] },
  { value: "archived", words: ["archived", "archive"] },
  { value: "done", words: ["done", "completed", "finished"] },
  { value: "todo", words: ["todo", "to-do"] },
] as const;

const isOptionLabel = (t: SearchTranslator, value: string): string => {
  const option = IS_OPTIONS.find((candidate) => candidate.value === value);
  return option ? t(`suggestions.isOptions.${option.value}`) : value;
};

const QUOTES = new Set(['"', "“", "”"]);

export function currentSearchToken(text: string): {
  start: number;
  token: string;
} {
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "\\" && inQuotes) {
      index += 1;
      continue;
    }
    if (QUOTES.has(character)) {
      inQuotes = !inQuotes;
    } else if (!inQuotes && /\s/.test(character)) {
      start = index + 1;
    }
  }
  return { start, token: text.slice(start) };
}

/**
 * Whether the word after `before` belongs to an operator: the text has an
 * `OR` outside parentheses (`a OR b tag:x` is `a OR (b tag:x)`), or an open
 * `(` hasn't closed. A completed filter there stays in the text, since a pill
 * of its own would leave the OR or group.
 */
export function continuesOperator(before: string): boolean {
  let depth = 0;
  let inQuotes = false;
  let word = "";
  let topLevelOr = false;
  const endWord = () => {
    if (word === "OR" && depth === 0) {
      topLevelOr = true;
    }
    word = "";
  };
  for (let index = 0; index < before.length; index += 1) {
    const character = before[index] ?? "";
    if (character === "\\" && inQuotes) {
      index += 1;
    } else if (QUOTES.has(character)) {
      inQuotes = !inQuotes;
      word = "";
    } else if (!inQuotes && character === "(") {
      endWord();
      depth += 1;
    } else if (!inQuotes && character === ")") {
      endWord();
      depth = Math.max(0, depth - 1);
    } else if (!inQuotes && /\s/.test(character)) {
      endWord();
    } else if (!inQuotes) {
      word += character;
    }
  }
  endWord();
  return depth > 0 || topLevelOr;
}

const unquote = (value: string) =>
  value.replace(/^["“”]/, "").replace(/["“”]$/, "");

const rank = <T>(
  items: readonly T[],
  text: string,
  nameOf: (item: T) => string,
  limit: number,
  countOf: (item: T) => number = () => 0
): T[] => {
  const needle = text.trim().toLowerCase();
  const byCount = (list: T[]) =>
    list.sort((left, right) => countOf(right) - countOf(left));
  if (!needle) {
    return byCount([...items]).slice(0, limit);
  }
  const exact: T[] = [];
  const starts: T[] = [];
  const words: T[] = [];
  for (const item of items) {
    const name = nameOf(item).toLowerCase();
    if (name === needle) {
      exact.push(item);
    } else if (name.startsWith(needle)) {
      starts.push(item);
    } else if (
      name.split(/[\s\-_./]+/).some((word) => word.startsWith(needle))
    ) {
      words.push(item);
    }
  }
  return [...exact, ...byCount(starts), ...byCount(words)].slice(0, limit);
};

const complete = (
  qualifier: SearchQualifier,
  group: SearchSuggestionGroup,
  label: string,
  detail?: string
): SearchSuggestion => {
  const insert = formatSearchQualifier(qualifier);
  return {
    complete: true,
    detail,
    group,
    id: `${group}:${insert}`,
    insert,
    key: qualifier.key,
    label,
    type: qualifier.key === "type" ? qualifier.value : undefined,
  };
};

interface SuggestionText {
  /** The locale for counts; undefined is the browser's. */
  locale?: string;
  t: SearchTranslator;
}

const countLabel = (count: number, locale?: string) =>
  count.toLocaleString(locale);

const valueSuggestions = (
  key: SearchQualifierKey,
  value: string,
  sources: SearchSuggestionSources,
  limit: number,
  { locale, t }: SuggestionText
): SearchSuggestion[] => {
  switch (key) {
    case "tag":
      return rank(
        sources.tags ?? [],
        value,
        (tag) => tag.name,
        limit,
        (tag) => tag.count
      ).map((tag) =>
        complete(
          { key: "tag", value: tag.name },
          "Tags",
          tag.name,
          isHiddenTagList([tag.name])
            ? t("suggestions.hiddenTagCount", {
                count: countLabel(tag.count, locale),
              })
            : countLabel(tag.count, locale)
        )
      );
    case "type":
      return rank(
        cardTypes,
        value,
        (type) => `${type} ${CARD_TYPE_LABELS[type]}`,
        limit
      ).map((type) =>
        complete({ key: "type", value: type }, "Types", t(`cardTypes.${type}`))
      );
    case "is": {
      const needle = value.trim().toLowerCase();
      return IS_OPTIONS.filter(
        (option) =>
          !needle || option.words.some((word) => word.startsWith(needle))
      ).map((option) =>
        complete(
          { key: "is", value: option.value },
          "Show",
          isOptionLabel(t, option.value)
        )
      );
    }
    case "site":
      return rank(
        sources.sites ?? [],
        value.replace(/^www\./i, ""),
        (site) => `${site.host} ${site.label}`,
        limit,
        (site) => site.count
      ).map((site) =>
        complete(
          { key: "site", value: site.host },
          "Sites",
          site.label || hostForDisplay(site.host),
          countLabel(site.count, locale)
        )
      );
    case "folder":
      return rank(
        sources.folders ?? [],
        value,
        (folder) => folder.name,
        limit
      ).map((folder) =>
        complete({ key: "folder", value: folder.name }, "Folders", folder.name)
      );
    default:
      return [];
  }
};

const excluded = (suggestion: SearchSuggestion): SearchSuggestion => ({
  ...suggestion,
  group: "Exclude",
  id: `Exclude:-${suggestion.insert}`,
  insert: `-${suggestion.insert}`,
});

/** Suggestions for a token after a `-`: the filters to leave out. */
const excludeSuggestions = (
  token: string,
  sources: SearchSuggestionSources,
  text: SuggestionText
): SearchSuggestionResult => {
  const result = buildSearchSuggestions(token, sources, text);
  const word = token.toLowerCase();
  const keys = EXCLUDE_HINTS.filter((key) => key.startsWith(word)).map(
    (key): SearchSuggestion => ({
      complete: false,
      detail: text.t(`suggestions.excludeHints.${key}`),
      group: "Exclude",
      id: `Exclude:-${key}`,
      insert: `-${key}:`,
      key,
      label: `-${key}:`,
    })
  );
  const isKeyHint = (suggestion: SearchSuggestion) =>
    suggestion.group === "Filters";
  const allowed = (suggestion: SearchSuggestion) =>
    EXCLUDE_HINTS.some((key) => key === suggestion.key);
  return {
    completingValue: result.completingValue,
    suggestions: [
      ...(token.includes(":") || token.startsWith("#") ? [] : keys),
      ...result.suggestions
        .filter((suggestion) => !isKeyHint(suggestion) && allowed(suggestion))
        .map(excluded),
    ],
  };
};

export function buildSearchSuggestions(
  token: string,
  sources: SearchSuggestionSources,
  {
    afterWord = false,
    locale,
    t = englishSearch,
  }: { afterWord?: boolean; locale?: string; t?: SearchTranslator } = {}
): SearchSuggestionResult {
  const text: SuggestionText = { locale, t };
  const none = { completingValue: false, suggestions: [] };
  if (!token.trim()) {
    return none;
  }

  if (token.startsWith("-") && !token.startsWith("--")) {
    return excludeSuggestions(token.slice(1), sources, text);
  }

  // `OR` joins two words or filters, so it is offered only after one.
  if (afterWord && /^or?$/i.test(token)) {
    const positive = buildSearchSuggestions(token, sources, text);
    return {
      completingValue: false,
      suggestions: [orSuggestion(t), ...positive.suggestions],
    };
  }

  if (token.startsWith("#")) {
    const value = unquote(token.slice(1));
    const isColor = parseSearchQuery(token).terms.length > 0;
    return {
      completingValue: !isColor,
      suggestions: valueSuggestions(
        "tag",
        value,
        sources,
        SEARCH_SUGGESTION_GROUP_LIMIT,
        text
      ),
    };
  }

  const qualifier = /^(tag|type|is|site|folder):([\s\S]*)$/i.exec(token);
  if (qualifier) {
    const key = (qualifier[1] ?? "").toLowerCase() as SearchQualifierKey;
    const value = unquote(qualifier[2] ?? "");
    const suggestions = valueSuggestions(
      key,
      value,
      sources,
      SEARCH_SUGGESTION_GROUP_LIMIT,
      text
    );
    const typed = parseSearchQuery(token).qualifiers[0];
    const exact =
      typed &&
      suggestions.length === 1 &&
      suggestions[0]?.insert === formatSearchQualifier(typed);
    return exact ? none : { completingValue: true, suggestions };
  }

  const word = token.toLowerCase();
  const keys: SearchSuggestion[] = QUALIFIER_HINTS.filter((key) =>
    key.startsWith(word)
  ).map((key) => ({
    complete: false,
    detail: t(`suggestions.hints.${key}`),
    group: "Filters",
    id: `Filters:${key}`,
    insert: `${key}:`,
    key,
    label: `${key}:`,
  }));
  if (word.length < 2 || word.includes(":")) {
    return { completingValue: false, suggestions: keys };
  }
  return {
    completingValue: false,
    suggestions: [
      ...keys,
      ...valueSuggestions("tag", word, sources, WORD_GROUP_LIMIT, text),
      ...valueSuggestions("folder", word, sources, WORD_GROUP_LIMIT, text),
      ...valueSuggestions("site", word, sources, WORD_GROUP_LIMIT, text),
    ],
  };
}

export interface QualifierChipDescription {
  /** The chip leaves these cards out: `-tag:old`. */
  excluded?: true;
  label: string;
  qualifier: SearchQualifier;
  title: string;
}

export function describeQualifierChip(
  chip: string,
  anchorTitle?: string,
  t: SearchTranslator = englishSearch
): QualifierChipDescription | null {
  const parsed = parseSearchQuery(chip);
  const [qualifier] = parsed.qualifiers;
  if (qualifier) {
    return describeQualifier(qualifier, t, anchorTitle);
  }
  const { expression } = parsed;
  if (expression?.op === "not" && expression.item.op === "qualifier") {
    const described = describeQualifier(expression.item.qualifier, t);
    return described ? { ...described, excluded: true } : null;
  }
  return null;
}

/**
 * How a word pill reads: an excluded word or phrase (`-figma`) shows the word
 * after a minus, and an OR group shows without its outer parentheses.
 */
export function describeKeywordChip(chip: string): {
  excluded?: true;
  group?: true;
  label: string;
} {
  const { expression } = parseSearchQuery(chip);
  if (!expression) {
    return { label: chip };
  }
  if (
    expression.op === "not" &&
    (expression.item.op === "term" || expression.item.op === "phrase")
  ) {
    return {
      excluded: true,
      label: formatSearchExpression(expression.item),
    };
  }
  return { group: true, label: formatSearchExpression(expression) };
}

function describeQualifier(
  qualifier: SearchQualifier,
  t: SearchTranslator,
  anchorTitle?: string
): QualifierChipDescription | null {
  switch (qualifier.key) {
    case "tag":
      return {
        qualifier,
        title: t("chips.titles.tag"),
        label: qualifier.value,
      };
    case "type":
      return {
        qualifier,
        title: t("chips.titles.type"),
        label: t(`cardTypes.${qualifier.value}`),
      };
    case "is":
      return {
        qualifier,
        title: t("chips.titles.is"),
        label: isOptionLabel(t, qualifier.value),
      };
    case "site":
      return {
        qualifier,
        title: t("chips.titles.site"),
        label: hostForDisplay(qualifier.value),
      };
    case "folder":
      return {
        qualifier,
        title: t("chips.titles.folder"),
        label: qualifier.value,
      };
    case "like":
      return {
        qualifier,
        title: t("chips.titles.like"),
        label: anchorTitle ?? t("chips.anyCard"),
      };
    case "mood":
      return {
        qualifier,
        title: t("chips.titles.mood"),
        label: t("chips.moodValue", { value: qualifier.value }),
      };
    case "price": {
      const bound = parsePriceBound(qualifier.value);
      return bound
        ? {
            qualifier,
            title: t("chips.titles.price"),
            label: describePriceBound(bound),
          }
        : null;
    }
    case "text":
      return {
        qualifier,
        title: t("chips.titles.text"),
        label: qualifier.value,
      };
    default:
      return null;
  }
}
