import type { SearchIsValue, SearchQualifierKey } from "./qualifiers";

/**
 * The hints every app's search field offers, as data. The web builds its
 * suggestions from these, and `apps/{apple,android}/scripts/shared-constants.ts`
 * generate them into the native apps. Qualifier keys, inserts and `OR` are
 * search syntax and stay English; `messageKey` names the catalog message
 * (in `packages/i18n`) that says what each one does.
 */
export type SearchSuggestionGroup =
  | "Combine"
  | "Exclude"
  | "Filters"
  | "Tags"
  | "Types"
  | "Folders"
  | "Sites"
  | "Show";

export interface SearchSuggestionHint {
  readonly group: SearchSuggestionGroup;
  readonly id: string;
  readonly insert: string;
  readonly key: SearchQualifierKey | "OR";
  readonly messageKey: `search.suggestions.${string}`;
}

export const SEARCH_SUGGESTION_GROUP_MESSAGE_KEYS = {
  Combine: "search.suggestions.groups.combine",
  Exclude: "search.suggestions.groups.exclude",
  Filters: "search.suggestions.groups.filters",
  Tags: "search.suggestions.groups.tags",
  Types: "search.suggestions.groups.types",
  Folders: "search.suggestions.groups.folders",
  Sites: "search.suggestions.groups.sites",
  Show: "search.suggestions.groups.show",
} as const satisfies Record<SearchSuggestionGroup, string>;

export const SEARCH_QUALIFIER_HINTS = [
  {
    id: "Filters:tag",
    group: "Filters",
    key: "tag",
    insert: "tag:",
    messageKey: "search.suggestions.hints.tag",
  },
  {
    id: "Filters:type",
    group: "Filters",
    key: "type",
    insert: "type:",
    messageKey: "search.suggestions.hints.type",
  },
  {
    id: "Filters:site",
    group: "Filters",
    key: "site",
    insert: "site:",
    messageKey: "search.suggestions.hints.site",
  },
  {
    id: "Filters:folder",
    group: "Filters",
    key: "folder",
    insert: "folder:",
    messageKey: "search.suggestions.hints.folder",
  },
  {
    id: "Filters:is",
    group: "Filters",
    key: "is",
    insert: "is:",
    messageKey: "search.suggestions.hints.is",
  },
  {
    id: "Filters:mood",
    group: "Filters",
    key: "mood",
    insert: "mood:",
    messageKey: "search.suggestions.hints.mood",
  },
  {
    id: "Filters:price",
    group: "Filters",
    key: "price",
    insert: "price:",
    messageKey: "search.suggestions.hints.price",
  },
  {
    id: "Filters:text",
    group: "Filters",
    key: "text",
    insert: "text:",
    messageKey: "search.suggestions.hints.text",
  },
] as const satisfies readonly SearchSuggestionHint[];

export const SEARCH_EXCLUDE_HINTS = [
  {
    id: "Exclude:-tag",
    group: "Exclude",
    key: "tag",
    insert: "-tag:",
    messageKey: "search.suggestions.excludeHints.tag",
  },
  {
    id: "Exclude:-type",
    group: "Exclude",
    key: "type",
    insert: "-type:",
    messageKey: "search.suggestions.excludeHints.type",
  },
  {
    id: "Exclude:-site",
    group: "Exclude",
    key: "site",
    insert: "-site:",
    messageKey: "search.suggestions.excludeHints.site",
  },
  {
    id: "Exclude:-folder",
    group: "Exclude",
    key: "folder",
    insert: "-folder:",
    messageKey: "search.suggestions.excludeHints.folder",
  },
  {
    id: "Exclude:-is",
    group: "Exclude",
    key: "is",
    insert: "-is:",
    messageKey: "search.suggestions.excludeHints.is",
  },
] as const satisfies readonly SearchSuggestionHint[];

export const SEARCH_OR_HINT = {
  id: "Combine:OR",
  group: "Combine",
  key: "OR",
  insert: "OR ",
  messageKey: "search.suggestions.orDetail",
} as const satisfies SearchSuggestionHint;

export interface SearchIsOption {
  readonly messageKey: `search.suggestions.isOptions.${SearchIsValue}`;
  readonly value: SearchIsValue;
  /** What people type after `is:`, so they stay English. */
  readonly words: readonly string[];
}

export const SEARCH_IS_OPTIONS = [
  {
    value: "fav",
    words: ["fav", "favorites", "starred"],
    messageKey: "search.suggestions.isOptions.fav",
  },
  {
    value: "archived",
    words: ["archived", "archive"],
    messageKey: "search.suggestions.isOptions.archived",
  },
  {
    value: "done",
    words: ["done", "completed", "finished"],
    messageKey: "search.suggestions.isOptions.done",
  },
  {
    value: "todo",
    words: ["todo", "to-do"],
    messageKey: "search.suggestions.isOptions.todo",
  },
  {
    value: "pinned",
    words: ["pinned", "pin", "pins"],
    messageKey: "search.suggestions.isOptions.pinned",
  },
] as const satisfies readonly SearchIsOption[];
