import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CreatedAtRange } from "../shared";
import type { CardType } from "../shared/constants";
import {
  COLOR_CARD_TYPES,
  type ColorHueBucket,
  normalizeHueFilters,
  normalizeVisualStyleFilters,
  VISUAL_STYLE_CARD_TYPES,
  type VisualStyle,
} from "../shared/constants";
import { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION } from "../shared/search/constants";
import {
  type CardListSort,
  compareCardsBySavedAt,
  savedAtOf,
} from "../shared/search/sort";
import { matchesVisualFilters } from "../shared/search/visualFilters";
import { isCardHidden } from "../shared/tags";
import { normalizeHexFilters } from "../shared/utils/colorUtils";
import { type CardListScope, cardListStream } from "./listQuery";
import { isSavedAtInRange } from "./queryUtils";

export interface VisualFilterState {
  hasVisualFilters: boolean;
  hexFilters?: string[];
  hueFilters?: ColorHueBucket[];
  styleFilters?: VisualStyle[];
}

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

    if (!isSavedAtInRange(savedAtOf(card), options.createdAtRange)) {
      return false;
    }

    return matchesVisualFilters(card, options.visualFilters);
  });

const visualTypesWithin = (
  types: readonly CardType[] | undefined,
  visualFilters: VisualFilterState
): readonly CardType[] => {
  const visualTypes = visualFilters.styleFilters?.length
    ? VISUAL_STYLE_CARD_TYPES
    : COLOR_CARD_TYPES;
  return types?.length
    ? visualTypes.filter((type) => types.includes(type))
    : visualTypes;
};

export const visualFilterTypes = (
  types: readonly CardType[] | undefined,
  visualFilters: VisualFilterState
): readonly CardType[] | "any" | "none" => {
  if (!visualFilters.hasVisualFilters) {
    return types?.length ? types : "any";
  }
  const within = visualTypesWithin(types, visualFilters);
  return within.length > 0 ? within : "none";
};

export const VISUAL_SCAN_LIMIT = 1000;

// Convex search indexes don't cover array fields such as colors and styles,
// so this scans each type that can match in date order.
export const findVisualMatches = async (
  ctx: QueryCtx,
  options: {
    userId: string;
    scope?: CardListScope;
    types?: CardType[];
    favoritesOnly?: boolean;
    createdAtRange?: CreatedAtRange;
    visualFilters: VisualFilterState;
    limit: number;
    sort?: CardListSort;
    includeHidden?: boolean;
  }
): Promise<Doc<"cards">[]> => {
  if (!options.visualFilters.hasVisualFilters) {
    return [];
  }
  const sort = options.sort ?? "newest";
  const types = visualTypesWithin(options.types, options.visualFilters);
  const perType = await Promise.all(
    types.map(async (type) => {
      const { rows, residual } = cardListStream(
        ctx,
        {
          userId: options.userId,
          scope: options.scope,
          favoritesOnly: options.favoritesOnly,
          types: [type],
          savedAt: options.createdAtRange
            ? {
                gte: options.createdAtRange.start,
                lt: options.createdAtRange.end,
              }
            : undefined,
        },
        sort === "oldest" ? "asc" : "desc"
      );
      const matches: Doc<"cards">[] = [];
      let read = 0;
      for await (const card of rows) {
        read += 1;
        if (
          (!residual || residual(card)) &&
          (options.includeHidden || !isCardHidden(card)) &&
          matchesVisualFilters(card, options.visualFilters)
        ) {
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
    .sort((a, b) => compareCardsBySavedAt(a, b, sort))
    .slice(0, options.limit);
};
