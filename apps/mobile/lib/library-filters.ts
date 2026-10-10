import {
  type CardType,
  COLOR_HUE_LABELS,
  type ColorHueBucket,
} from "@teak/convex/shared/constants";

/** Plural names for menus and titles. */
export const CARD_TYPE_PLURALS: Record<CardType, string> = {
  text: "Notes",
  link: "Links",
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
  palette: "Palettes",
  quote: "Quotes",
};

/** The home grid's filters, matching the web's type, favorite, Trash, and color chips. */
export interface LibraryFilters {
  favoritesOnly: boolean;
  hue?: ColorHueBucket;
  trashOnly: boolean;
  types: CardType[];
}

export const EMPTY_FILTERS: LibraryFilters = {
  favoritesOnly: false,
  trashOnly: false,
  types: [],
};

export const hasActiveFilters = (filters: LibraryFilters): boolean =>
  filters.favoritesOnly ||
  filters.trashOnly ||
  filters.types.length > 0 ||
  filters.hue !== undefined;

export const toggleType = (
  filters: LibraryFilters,
  type: CardType
): LibraryFilters => ({
  ...filters,
  types: filters.types.includes(type)
    ? filters.types.filter((current) => current !== type)
    : [...filters.types, type],
});

/** The arguments the mobile search query takes for these filters. */
export const toSearchArgs = (filters: LibraryFilters) => ({
  favoritesOnly: filters.favoritesOnly || undefined,
  hueFilters: filters.hue ? [filters.hue] : undefined,
  showTrashOnly: filters.trashOnly || undefined,
  types: filters.types.length > 0 ? filters.types : undefined,
});

/** The large title names the view, like Photos: "Trash", "Favorites", "Links". */
export const filtersTitle = (filters: LibraryFilters): string => {
  if (filters.trashOnly) {
    return "Trash";
  }
  const [onlyType] = filters.types;
  const typeTitle =
    filters.types.length === 1 && onlyType ? CARD_TYPE_PLURALS[onlyType] : null;
  if (filters.favoritesOnly) {
    return typeTitle ? `Favorite ${typeTitle}` : "Favorites";
  }
  if (typeTitle) {
    return typeTitle;
  }
  if (filters.hue) {
    return COLOR_HUE_LABELS[filters.hue];
  }
  return filters.types.length > 1 ? "Filtered" : "Home";
};
