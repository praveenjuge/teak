import {
  type CardListSort,
  normalizeCardListSort,
  parseShuffleSeed,
} from "@teak/convex/shared";
import { type CardType, isCardType } from "@teak/convex/shared/constants";

export type LibrarySort = CardListSort | "revisit";

export const isSeededSort = (sort: LibrarySort): boolean =>
  sort === "shuffle" || sort === "revisit";

export const queryOrder = (state: {
  seed?: number;
  sort: LibrarySort;
}): { shuffleSeed?: number; sort: CardListSort } =>
  isSeededSort(state.sort)
    ? {
        ...(state.seed === undefined ? {} : { shuffleSeed: state.seed }),
        sort: "shuffle",
      }
    : { sort: normalizeCardListSort(state.sort) };

export interface SearchUrlState {
  q: string;
  seed?: number;
  sort: LibrarySort;
  /**
   * Newest was picked over a search's default Best match, so the URL names
   * it (`sort=newest`) and a reload keeps it.
   */
  sortPicked?: boolean;
  tag?: string;
  types: CardType[];
}

/**
 * Longest tag the URL keeps. A tag has at most 64 characters, but some
 * letters grow when lowercased (a capital İ becomes two), so the lowercased
 * name the tag list uses can be longer.
 */
const MAX_URL_TAG_LENGTH = 256;

export function parseTagParam(value: string | null): string {
  return (value ?? "").trim().toLowerCase().slice(0, MAX_URL_TAG_LENGTH);
}

export const MAX_URL_SEARCH_LENGTH = 500;

interface ReadableParams {
  get: (name: string) => string | null;
}

export const EMPTY_SEARCH_URL_STATE: SearchUrlState = {
  q: "",
  sort: "newest",
  tag: "",
  types: [],
};

export function parseCardTypesParam(value: string | null): CardType[] {
  const types: CardType[] = [];
  for (const part of (value ?? "").split(",")) {
    const type = part.trim().toLowerCase();
    if (isCardType(type) && !types.includes(type)) {
      types.push(type);
    }
  }
  return types;
}

export const parseLibrarySort = (value: string | null): LibrarySort =>
  value === "revisit" ? value : normalizeCardListSort(value);

export function parseSearchUrlState(params: ReadableParams): SearchUrlState {
  const sort = parseLibrarySort(params.get("sort"));
  const seed = isSeededSort(sort)
    ? parseShuffleSeed(params.get("seed"))
    : undefined;
  return {
    q: (params.get("q") ?? "").trim().slice(0, MAX_URL_SEARCH_LENGTH),
    ...(seed === undefined ? {} : { seed }),
    sort,
    ...(params.get("sort") === "newest" ? { sortPicked: true } : {}),
    tag: parseTagParam(params.get("tag")),
    types: parseCardTypesParam(params.get("type")),
  };
}

const shuffleSeedOf = (state: SearchUrlState): number | undefined =>
  isSeededSort(parseLibrarySort(state.sort)) ? state.seed : undefined;

const pickedNewest = (state: SearchUrlState): boolean =>
  state.sortPicked === true && parseLibrarySort(state.sort) === "newest";

export function serializeSearchUrlState(
  state: SearchUrlState,
  params: URLSearchParams | string = ""
): string {
  const next = new URLSearchParams(params);
  const q = state.q.trim().slice(0, MAX_URL_SEARCH_LENGTH);
  if (q) {
    next.set("q", q);
  } else {
    next.delete("q");
  }
  if (
    state.sort === "oldest" ||
    state.sort === "shuffle" ||
    state.sort === "revisit"
  ) {
    next.set("sort", state.sort);
  } else if (pickedNewest(state)) {
    next.set("sort", "newest");
  } else {
    next.delete("sort");
  }
  const seed = shuffleSeedOf(state);
  if (seed === undefined) {
    next.delete("seed");
  } else {
    next.set("seed", String(seed));
  }
  if (state.types.length > 0) {
    next.set("type", state.types.join(","));
  } else {
    next.delete("type");
  }
  const tag = parseTagParam(state.tag ?? null);
  if (tag) {
    next.set("tag", tag);
  } else {
    next.delete("tag");
  }
  return next.toString().replace(/%2C/g, ",");
}

const sameTypes = (left: CardType[], right: CardType[]): boolean =>
  left.length === right.length && left.every((type) => right.includes(type));

export const isSameSearchUrlState = (
  left: SearchUrlState,
  right: SearchUrlState
): boolean =>
  left.q.trim() === right.q.trim() &&
  parseLibrarySort(left.sort) === parseLibrarySort(right.sort) &&
  pickedNewest(left) === pickedNewest(right) &&
  shuffleSeedOf(left) === shuffleSeedOf(right) &&
  parseTagParam(left.tag ?? null) === parseTagParam(right.tag ?? null) &&
  sameTypes(left.types, right.types);
