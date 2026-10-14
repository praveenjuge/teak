import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
import type { CreatedAtRange } from "../shared";
import {
  COLOR_CARD_TYPES,
  type ColorHueBucket,
  isColorCardType,
  normalizeHueFilters,
  normalizeVisualStyleFilters,
  type VisualStyle,
} from "../shared/constants";
import { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION } from "../shared/search/constants";
import {
  type CardListSort,
  compareCardsByCreatedAt,
} from "../shared/search/sort";
import { normalizeHexFilters } from "../shared/utils/colorUtils";
import { type ArchivedFilter, buildCardListQuery } from "./listQuery";

export interface VisualFilterState {
  hasVisualFilters: boolean;
  hexFilters?: string[];
  hueFilters?: ColorHueBucket[];
  styleFilters?: VisualStyle[];
}

const isCreatedAtInRange = (
  createdAt: number,
  range?: CreatedAtRange
): boolean => !range || (createdAt >= range.start && createdAt < range.end);

export const normalizeVisualFilterArgs = (args: {
  styleFilters?: string[];
  hueFilters?: string[];
  hexFilters?: string[];
}): VisualFilterState => {
  const styleFilters = normalizeVisualStyleFilters(args.styleFilters);
  const hueFilters = normalizeHueFilters(args.hueFilters);
  const { normalized: hexFilters, invalid: invalidHexFilters } =
    normalizeHexFilters(args.hexFilters);

  if (invalidHexFilters.length > 0) {
    throw new Error("Invalid hexFilters");
  }

  // Cap each dimension so an authenticated caller cannot fan out an unbounded
  // number of concurrent facet queries via Promise.all in runVisualFacetQueries.
  // Style/hue are already bounded by their enums; hex values are caller-supplied.
  const cappedStyleFilters = styleFilters.slice(
    0,
    SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION
  );
  const cappedHueFilters = hueFilters.slice(
    0,
    SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION
  );
  const cappedHexFilters = hexFilters.slice(
    0,
    SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION
  );

  return {
    styleFilters:
      cappedStyleFilters.length > 0 ? cappedStyleFilters : undefined,
    hueFilters: cappedHueFilters.length > 0 ? cappedHueFilters : undefined,
    hexFilters: cappedHexFilters.length > 0 ? cappedHexFilters : undefined,
    hasVisualFilters:
      cappedStyleFilters.length > 0 ||
      cappedHueFilters.length > 0 ||
      cappedHexFilters.length > 0,
  };
};

export const doesCardMatchVisualFilters = (
  card: Doc<"cards">,
  visualFilters: VisualFilterState
): boolean => {
  if (!visualFilters.hasVisualFilters) {
    return true;
  }

  if (visualFilters.styleFilters?.length) {
    if (card.type !== "image") {
      return false;
    }

    const styleSet = new Set(card.visualStyles ?? []);
    if (!visualFilters.styleFilters.some((style) => styleSet.has(style))) {
      return false;
    }
  }

  if (visualFilters.hueFilters?.length) {
    if (!isColorCardType(card.type)) {
      return false;
    }

    const hueSet = new Set(card.colorHues ?? []);
    if (!visualFilters.hueFilters.some((hue) => hueSet.has(hue))) {
      return false;
    }
  }

  if (visualFilters.hexFilters?.length) {
    if (!isColorCardType(card.type)) {
      return false;
    }

    const hexSet = new Set(card.colorHexes ?? []);
    if (!visualFilters.hexFilters.some((hex) => hexSet.has(hex))) {
      return false;
    }
  }

  return true;
};

export const applyCardLevelFilters = (
  cards: Doc<"cards">[],
  options: {
    types?: string[];
    favoritesOnly?: boolean;
    createdAtRange?: CreatedAtRange;
    visualFilters: VisualFilterState;
  }
) =>
  cards.filter((card) => {
    if (options.types?.length && !options.types.includes(card.type)) {
      return false;
    }

    if (options.favoritesOnly && card.isFavorited !== true) {
      return false;
    }

    if (!isCreatedAtInRange(card.createdAt, options.createdAtRange)) {
      return false;
    }

    return doesCardMatchVisualFilters(card, options.visualFilters);
  });

/** Only images carry styles; COLOR_CARD_TYPES carry colors. */
const VISUAL_STYLE_TYPES: readonly CardType[] = ["image"];

/**
 * The card types that can match the visual filters, within the requested
 * types: undefined when any type can, an empty list when none can.
 */
export const visualFilterTypes = (
  types: readonly CardType[] | undefined,
  visualFilters: VisualFilterState
): readonly CardType[] | undefined => {
  if (!visualFilters.hasVisualFilters) {
    return types;
  }
  const visualTypes = visualFilters.styleFilters?.length
    ? VISUAL_STYLE_TYPES
    : COLOR_CARD_TYPES;
  return types?.length
    ? visualTypes.filter((type) => types.includes(type))
    : visualTypes;
};

/** How many cards of each type one color or style search reads at most. */
export const VISUAL_SCAN_LIMIT = 1000;

/**
 * The newest (or oldest) cards matching color or style filters. Colors and
 * styles are stored as arrays, which Convex search indexes don't cover, so
 * this reads each type that can match (images, palettes, videos) in date order and
 * keeps the matches: up to `limit` of them, within VISUAL_SCAN_LIMIT cards
 * of each type.
 */
export const findVisualMatches = async (
  ctx: QueryCtx,
  options: {
    userId: string;
    showTrashOnly?: boolean;
    archived?: ArchivedFilter;
    types?: CardType[];
    favoritesOnly?: boolean;
    createdAtRange?: CreatedAtRange;
    visualFilters: VisualFilterState;
    limit: number;
    sort?: CardListSort;
  }
): Promise<Doc<"cards">[]> => {
  if (!options.visualFilters.hasVisualFilters) {
    return [];
  }
  const sort = options.sort ?? "newest";
  const types = visualFilterTypes(options.types, options.visualFilters) ?? [];
  const perType = await Promise.all(
    types.map(async (type) => {
      const cards = buildCardListQuery(ctx, {
        userId: options.userId,
        trash: options.showTrashOnly,
        archived: options.archived,
        favoritesOnly: options.favoritesOnly,
        types: [type],
        createdAt: options.createdAtRange
          ? {
              gte: options.createdAtRange.start,
              lt: options.createdAtRange.end,
            }
          : undefined,
      }).order(sort === "oldest" ? "asc" : "desc");
      const matches: Doc<"cards">[] = [];
      let read = 0;
      for await (const card of cards) {
        read += 1;
        if (doesCardMatchVisualFilters(card, options.visualFilters)) {
          matches.push(card);
        }
        if (matches.length >= options.limit || read >= VISUAL_SCAN_LIMIT) {
          break;
        }
      }
      return matches;
    })
  );
  return perType
    .flat()
    .sort((a, b) => compareCardsByCreatedAt(a, b, sort))
    .slice(0, options.limit);
};
