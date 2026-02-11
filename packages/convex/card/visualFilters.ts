import type { Doc } from "../_generated/dataModel";
import type { CreatedAtRange } from "../shared";
import {
  type ColorHueBucket,
  normalizeHueFilters,
  normalizeVisualStyleFilters,
  type VisualStyle,
} from "../shared/constants";
import { normalizeHexFilters } from "../shared/utils/colorUtils";

export type VisualFilterState = {
  styleFilters?: VisualStyle[];
  hueFilters?: ColorHueBucket[];
  hexFilters?: string[];
  hasVisualFilters: boolean;
};

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

  return {
    styleFilters: styleFilters.length > 0 ? styleFilters : undefined,
    hueFilters: hueFilters.length > 0 ? hueFilters : undefined,
    hexFilters: hexFilters.length > 0 ? hexFilters : undefined,
    hasVisualFilters:
      styleFilters.length > 0 || hueFilters.length > 0 || hexFilters.length > 0,
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
    if (!(card.type === "image" || card.type === "palette")) {
      return false;
    }

    const hueSet = new Set(card.colorHues ?? []);
    if (!visualFilters.hueFilters.some((hue) => hueSet.has(hue))) {
      return false;
    }
  }

  if (visualFilters.hexFilters?.length) {
    if (!(card.type === "image" || card.type === "palette")) {
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

const buildVisualSearchFilter = (options: {
  userId: string;
  showTrashOnly?: boolean;
  types?: string[];
  favoritesOnly?: boolean;
}) => {
  return (q: any) => {
    let search = q
      .eq("userId", options.userId)
      .eq("isDeleted", options.showTrashOnly ? true : undefined);

    if (options.types?.length === 1) {
      search = search.eq("type", options.types[0]);
    }

    if (options.favoritesOnly) {
      search = search.eq("isFavorited", true);
    }

    return search;
  };
};

export const runVisualFacetQueries = async (
  ctx: any,
  options: {
    userId: string;
    showTrashOnly?: boolean;
    types?: string[];
    favoritesOnly?: boolean;
    createdAtRange?: CreatedAtRange;
    visualFilters: VisualFilterState;
    limit: number;
  }
): Promise<Doc<"cards">[]> => {
  if (!options.visualFilters.hasVisualFilters) {
    return [];
  }

  const applySearchFilters = buildVisualSearchFilter(options);
  const queryRunners: Promise<Doc<"cards">[]>[] = [];

  for (const style of options.visualFilters.styleFilters ?? []) {
    queryRunners.push(
      ctx.db
        .query("cards")
        .withSearchIndex("search_visual_styles", (q: any) =>
          applySearchFilters(q).search("visualStyles", style)
        )
        .take(options.limit)
    );
  }

  for (const hue of options.visualFilters.hueFilters ?? []) {
    queryRunners.push(
      ctx.db
        .query("cards")
        .withSearchIndex("search_color_hues", (q: any) =>
          applySearchFilters(q).search("colorHues", hue)
        )
        .take(options.limit)
    );
  }

  for (const hex of options.visualFilters.hexFilters ?? []) {
    queryRunners.push(
      ctx.db
        .query("cards")
        .withSearchIndex("search_color_hexes", (q: any) =>
          applySearchFilters(q).search("colorHexes", hex)
        )
        .take(options.limit)
    );
  }

  const rawResults = (await Promise.all(queryRunners)).flat();
  const deduped = Array.from(
    new Map(rawResults.map((card) => [card._id, card])).values()
  );

  return applyCardLevelFilters(deduped, {
    types: options.types,
    favoritesOnly: options.favoritesOnly,
    createdAtRange: options.createdAtRange,
    visualFilters: options.visualFilters,
  }).sort((a, b) => b.createdAt - a.createdAt);
};
