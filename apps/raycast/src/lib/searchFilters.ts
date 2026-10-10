export const CARD_TYPES = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
] as const;

export const SORT_OPTIONS = ["newest", "oldest"] as const;

// Same vocabularies as Teak's web search chips.
export const HUE_OPTIONS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
  "brown",
  "neutral",
] as const;
export const STYLE_OPTIONS = [
  "abstract",
  "cinematic",
  "dark",
  "illustrative",
  "minimal",
  "monochrome",
  "moody",
  "pastel",
  "photographic",
  "retro",
  "surreal",
  "vintage",
  "vibrant",
] as const;

export type RaycastCardType = (typeof CARD_TYPES)[number];
export type RaycastSort = (typeof SORT_OPTIONS)[number];

export interface ParsedSearchFilters {
  /** `after:2026-09`: saved on or after this Unix ms timestamp. */
  createdAfter?: number;
  /** `before:2026-09`: saved before this Unix ms timestamp. */
  createdBefore?: number;
  favorited?: boolean;
  hasExplicitFilters: boolean;
  hex: string[];
  hue: string[];
  query: string;
  rawQuery: string;
  sort: RaycastSort;
  style: string[];
  tag?: string;
  trashed?: boolean;
  type?: RaycastCardType;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DATE_VALUE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

/** Parses `2026`, `2026-09`, or `2026-09-14` as the start of that period. */
export const parseDateFilter = (value: string): number | undefined => {
  const match = DATE_VALUE.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const month = match[2] ? Number(match[2]) - 1 : 0;
  const day = match[3] ? Number(match[3]) : 1;
  if (month > 11 || day < 1 || day > 31) {
    return undefined;
  }
  return new Date(Number(match[1]), month, day).getTime();
};

const formatDateFilter = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const CARD_TYPE_SET = new Set<string>(CARD_TYPES);

const normalizeString = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeType = (value?: string): RaycastCardType | undefined => {
  if (!(value && CARD_TYPE_SET.has(value))) {
    return undefined;
  }

  return value as RaycastCardType;
};

const normalizeSort = (value?: string): RaycastSort =>
  value === "oldest" ? "oldest" : "newest";

const normalizeFavorited = (value?: string): boolean | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (["fav", "favorite", "favorites", "true", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "no"].includes(normalized)) {
    return false;
  }

  return undefined;
};

const WHITESPACE = /\s/;
const NEEDS_QUOTING = /[\s":\\]/;

// Tokenizes the raw search text while keeping double-quoted spans intact so a
// value such as `tag:"design systems"` survives as a single token. Quotes are
// stripped from the emitted token and `\"`/`\\` escapes are unwrapped.
const tokenizeSearchText = (rawQuery: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let hasContent = false;
  let inQuotes = false;

  for (let index = 0; index < rawQuery.length; index += 1) {
    const char = rawQuery[index];

    if (inQuotes) {
      if (char === "\\" && index + 1 < rawQuery.length) {
        const next = rawQuery[index + 1];
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
          continue;
        }
      }

      if (char === '"') {
        inQuotes = false;
        continue;
      }

      current += char;
      hasContent = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      hasContent = true;
      continue;
    }

    if (WHITESPACE.test(char)) {
      if (hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }

    current += char;
    hasContent = true;
  }

  if (hasContent) {
    tokens.push(current);
  }

  return tokens;
};

const formatFilterValue = (value: string): string => {
  if (!NEEDS_QUOTING.test(value)) {
    return value;
  }

  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
};

export const parseSearchFilters = (rawQuery: string): ParsedSearchFilters => {
  const queryTerms: string[] = [];
  const tokens = tokenizeSearchText(rawQuery);

  let favorited: boolean | undefined;
  let sort: RaycastSort = "newest";
  let tag: string | undefined;
  let trashed: boolean | undefined;
  let type: RaycastCardType | undefined;
  let createdAfter: number | undefined;
  let createdBefore: number | undefined;
  const hue: string[] = [];
  const style: string[] = [];
  const hex: string[] = [];

  for (const token of tokens) {
    const normalized = token.toLowerCase();

    if (["fav", "favorite", "favorites"].includes(normalized)) {
      favorited = true;
      continue;
    }

    if (["trash", "trashed", "deleted"].includes(normalized)) {
      trashed = true;
      continue;
    }

    if (HEX_COLOR.test(token)) {
      hex.push(normalized);
      continue;
    }

    const [rawKey, ...rawValueParts] = token.split(":");
    if (!(rawKey && rawValueParts.length > 0)) {
      queryTerms.push(token);
      continue;
    }

    const key = rawKey.toLowerCase();
    const value = rawValueParts.join(":");

    if (key === "type") {
      const nextType = normalizeType(value.toLowerCase());
      if (nextType) {
        type = nextType;
        continue;
      }
    }

    if (key === "tag") {
      const nextTag = normalizeString(value);
      if (nextTag) {
        tag = nextTag;
        continue;
      }
    }

    if (key === "sort") {
      sort = normalizeSort(value.toLowerCase());
      continue;
    }

    if (
      key === "hue" &&
      (HUE_OPTIONS as readonly string[]).includes(value.toLowerCase())
    ) {
      hue.push(value.toLowerCase());
      continue;
    }

    if (
      key === "style" &&
      (STYLE_OPTIONS as readonly string[]).includes(value.toLowerCase())
    ) {
      style.push(value.toLowerCase());
      continue;
    }

    if (key === "after" || key === "before") {
      const timestamp = parseDateFilter(value);
      if (timestamp !== undefined) {
        if (key === "after") {
          createdAfter = timestamp;
        } else {
          createdBefore = timestamp;
        }
        continue;
      }
    }

    if (key === "in" && value.toLowerCase() === "trash") {
      trashed = true;
      continue;
    }

    if (key === "fav" || key === "favorite" || key === "favorited") {
      const nextFavorited = normalizeFavorited(value);
      if (nextFavorited !== undefined) {
        favorited = nextFavorited;
        continue;
      }
    }

    queryTerms.push(token);
  }

  return {
    createdAfter,
    createdBefore,
    favorited,
    hasExplicitFilters: Boolean(
      favorited !== undefined ||
      sort !== "newest" ||
      tag ||
      type ||
      trashed ||
      hue.length ||
      style.length ||
      hex.length ||
      createdAfter !== undefined ||
      createdBefore !== undefined,
    ),
    hex,
    hue,
    query: queryTerms.join(" ").trim(),
    rawQuery,
    sort,
    style,
    tag,
    trashed,
    type,
  };
};

export const buildSearchText = (filters: {
  createdAfter?: number;
  createdBefore?: number;
  favorited?: boolean;
  hex?: string[];
  hue?: string[];
  query?: string;
  sort?: RaycastSort;
  style?: string[];
  tag?: string;
  trashed?: boolean;
  type?: RaycastCardType;
}): string => {
  const tokens: string[] = [];

  const query = normalizeString(filters.query);
  if (query) {
    tokens.push(query);
  }

  if (filters.type) {
    tokens.push(`type:${formatFilterValue(filters.type)}`);
  }

  if (filters.tag) {
    tokens.push(`tag:${formatFilterValue(filters.tag)}`);
  }

  if (filters.favorited) {
    tokens.push("fav");
  }

  if (filters.trashed) {
    tokens.push("trash");
  }

  for (const value of filters.hue ?? []) {
    tokens.push(`hue:${value}`);
  }

  for (const value of filters.style ?? []) {
    tokens.push(`style:${value}`);
  }

  tokens.push(...(filters.hex ?? []));

  if (filters.createdAfter !== undefined) {
    tokens.push(`after:${formatDateFilter(filters.createdAfter)}`);
  }

  if (filters.createdBefore !== undefined) {
    tokens.push(`before:${formatDateFilter(filters.createdBefore)}`);
  }

  if (normalizeSort(filters.sort) === "oldest") {
    tokens.push("sort:oldest");
  }

  return tokens.join(" ").trim();
};

export const applyTrashedFilter = (
  rawQuery: string,
  trashed?: boolean,
): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({ ...parsed, trashed });
};

export const applyHueFilter = (rawQuery: string, hue?: string): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({ ...parsed, hue: hue ? [hue] : [] });
};

export const applyTagFilter = (rawQuery: string, tag: string): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({
    ...parsed,
    tag,
  });
};

export const applyTypeFilter = (
  rawQuery: string,
  type?: RaycastCardType,
): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({
    ...parsed,
    type,
  });
};

export const applySortFilter = (
  rawQuery: string,
  sort: RaycastSort,
): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({
    ...parsed,
    sort,
  });
};

export const applyFavoritedFilter = (
  rawQuery: string,
  favorited?: boolean,
): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({
    ...parsed,
    favorited,
  });
};

export const clearSearchFilters = (rawQuery: string): string => {
  const parsed = parseSearchFilters(rawQuery);
  return buildSearchText({
    query: parsed.query,
  });
};
