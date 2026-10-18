import {
  describePriceBound,
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

export interface SearchSuggestionSources {
  folders?: readonly { name: string }[];
  sites?: readonly { count: number; host: string; label: string }[];
  tags?: readonly { count: number; name: string }[];
}

export type SearchSuggestionGroup =
  | "Filters"
  | "Tags"
  | "Types"
  | "Folders"
  | "Sites"
  | "Show";

export interface SearchSuggestion {
  complete: boolean;
  detail?: string;
  group: SearchSuggestionGroup;
  id: string;
  insert: string;
  key: SearchQualifierKey;
  label: string;
  type?: CardType;
}

export interface SearchSuggestionResult {
  completingValue: boolean;
  suggestions: SearchSuggestion[];
}

export const SEARCH_SUGGESTION_GROUP_LIMIT = 8;
const WORD_GROUP_LIMIT = 4;

const QUALIFIER_HINTS: { key: SearchQualifierKey; hint: string }[] = [
  { key: "tag", hint: "Cards with a tag" },
  { key: "type", hint: "Links, images, notes…" },
  { key: "site", hint: "Links from a website" },
  { key: "folder", hint: "Cards in a folder" },
  { key: "is", hint: "Favorites, archived, done or to do" },
  { key: "mood", hint: "Images by mood" },
  { key: "price", hint: "Price under or over" },
  { key: "text", hint: "Words in images and scans" },
];

const IS_OPTIONS = [
  { value: "fav", label: "Favorites", words: ["fav", "favorites", "starred"] },
  { value: "archived", label: "Archived", words: ["archived", "archive"] },
  {
    value: "done",
    label: "Done",
    words: ["done", "completed", "finished"],
  },
  { value: "todo", label: "To do", words: ["todo", "to-do"] },
] as const;

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

const countLabel = (count: number) => count.toLocaleString();

const valueSuggestions = (
  key: SearchQualifierKey,
  value: string,
  sources: SearchSuggestionSources,
  limit: number
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
            ? `Shows hidden cards · ${countLabel(tag.count)}`
            : countLabel(tag.count)
        )
      );
    case "type":
      return rank(
        cardTypes,
        value,
        (type) => `${type} ${CARD_TYPE_LABELS[type]}`,
        limit
      ).map((type) =>
        complete({ key: "type", value: type }, "Types", CARD_TYPE_LABELS[type])
      );
    case "is": {
      const needle = value.trim().toLowerCase();
      return IS_OPTIONS.filter(
        (option) =>
          !needle || option.words.some((word) => word.startsWith(needle))
      ).map((option) =>
        complete({ key: "is", value: option.value }, "Show", option.label)
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
          countLabel(site.count)
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

export function buildSearchSuggestions(
  token: string,
  sources: SearchSuggestionSources
): SearchSuggestionResult {
  const none = { completingValue: false, suggestions: [] };
  if (!token.trim()) {
    return none;
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
        SEARCH_SUGGESTION_GROUP_LIMIT
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
      SEARCH_SUGGESTION_GROUP_LIMIT
    );
    const typed = parseSearchQuery(token).qualifiers[0];
    const exact =
      typed &&
      suggestions.length === 1 &&
      suggestions[0]?.insert === formatSearchQualifier(typed);
    return exact ? none : { completingValue: true, suggestions };
  }

  const word = token.toLowerCase();
  const keys: SearchSuggestion[] = QUALIFIER_HINTS.filter(({ key }) =>
    key.startsWith(word)
  ).map(({ key, hint }) => ({
    complete: false,
    detail: hint,
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
      ...valueSuggestions("tag", word, sources, WORD_GROUP_LIMIT),
      ...valueSuggestions("folder", word, sources, WORD_GROUP_LIMIT),
      ...valueSuggestions("site", word, sources, WORD_GROUP_LIMIT),
    ],
  };
}

export function describeQualifierChip(
  chip: string,
  anchorTitle?: string
): {
  label: string;
  qualifier: SearchQualifier;
  title: string;
} | null {
  const qualifier = parseSearchQuery(chip).qualifiers[0];
  if (!qualifier) {
    return null;
  }
  switch (qualifier.key) {
    case "tag":
      return { qualifier, title: "Tag", label: qualifier.value };
    case "type":
      return {
        qualifier,
        title: "Type",
        label: CARD_TYPE_LABELS[qualifier.value],
      };
    case "is":
      return {
        qualifier,
        title: "Show",
        label:
          IS_OPTIONS.find((option) => option.value === qualifier.value)
            ?.label ?? qualifier.value,
      };
    case "site":
      return {
        qualifier,
        title: "Site",
        label: hostForDisplay(qualifier.value),
      };
    case "folder":
      return { qualifier, title: "Folder", label: qualifier.value };
    case "like":
      return {
        qualifier,
        title: "Similar to",
        label: anchorTitle ?? "a card",
      };
    case "mood":
      return { qualifier, title: "Mood", label: `“${qualifier.value}”` };
    case "price": {
      const bound = parsePriceBound(qualifier.value);
      return bound
        ? { qualifier, title: "Price", label: describePriceBound(bound) }
        : null;
    }
    case "text":
      return { qualifier, title: "Text in image", label: qualifier.value };
    default:
      return null;
  }
}
