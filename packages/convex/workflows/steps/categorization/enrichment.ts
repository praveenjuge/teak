import {
  formatLinkPrice,
  type LinkCategory,
  type LinkCategoryDetail,
  type LinkPrice,
  parseStructuredPrice,
} from "@teak/convex/shared";
import {
  formatDate,
  type ProviderEnrichmentResult,
  type RawSelectorEntry,
  type RawSelectorMap,
} from "./providers/common";

const MAX_STORED_VARIANTS = 50;

const ISO_DURATION_REGEX = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i;
const STRUCTURED_DATA_FIELDS = [
  "name",
  "url",
  "image",
  "@type",
  "sameAs",
  "datePublished",
  "dateModified",
  "startDate",
  "endDate",
  "author",
  "creator",
  "publisher",
  "headline",
  "description",
  "aggregateRating",
  "recipeIngredient",
  "recipeInstructions",
  "offers",
  "genre",
  "keywords",
  "duration",
  "performer",
  "byArtist",
  "address",
  "servesCuisine",
  "priceRange",
  "operatingSystem",
  "applicationCategory",
  "gamePlatform",
  "isbn",
];

const PLACE_TYPES = [
  "Restaurant",
  "LocalBusiness",
  "Place",
  "LodgingBusiness",
  "Residence",
  "SingleFamilyResidence",
  "Apartment",
  "RealEstateListing",
];
const APP_TYPES = [
  "SoftwareApplication",
  "MobileApplication",
  "WebApplication",
];
const ADDRESS_PARTS = [
  "streetAddress",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
];

/** A JSON-LD node read from a page; every field is untrusted. */
export type JsonLdEntity = Record<string, unknown>;

export const isJsonLdEntity = (value: unknown): value is JsonLdEntity =>
  typeof value === "object" && value !== null;

const prop = (value: unknown, key: string): unknown =>
  isJsonLdEntity(value) ? value[key] : undefined;

/** `String(value)`, or undefined for a missing value, as `?.toString()` did. */
const stringified = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : String(value);

const toArray = (value: unknown): unknown[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

export const pickFields = (
  value: JsonLdEntity,
  fields: string[]
): JsonLdEntity => {
  const result: JsonLdEntity = {};
  for (const field of fields) {
    if (value[field] !== undefined) {
      result[field] = value[field];
    }
  }
  return result;
};

const matchesType = (candidate: JsonLdEntity, types: string[]): boolean => {
  const candidateTypes = toArray(candidate["@type"]).map((entry) =>
    typeof entry === "string" ? entry.toLowerCase() : ""
  );
  return types.some((type) => candidateTypes.includes(type.toLowerCase()));
};

const findByType = (
  entities: readonly JsonLdEntity[],
  typeCandidates: string[]
): JsonLdEntity | undefined =>
  entities.find((entity) => matchesType(entity, typeCandidates));

const stringArray = (value: unknown): string[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : prop(entry, "name")))
      .filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  const name = prop(value, "name");
  return typeof name === "string" && name ? [name] : [];
};

const valueToText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (!value) {
    return;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  const name = prop(value, "name");
  return typeof name === "string" && name ? name : undefined;
};

const urlOf = (value: unknown): string | undefined => {
  const url = prop(value, "url");
  return typeof url === "string" && url ? url : undefined;
};

const normalizeImage = (value: unknown): string | undefined => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first: unknown = value[0];
    if (typeof first === "string") {
      return first;
    }
    const firstUrl = urlOf(first);
    if (firstUrl) {
      return firstUrl;
    }
  }
  return urlOf(value);
};

const formatAddress = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (Array.isArray(value)) {
    return formatAddress(value[0]);
  }
  if (!isJsonLdEntity(value)) {
    return;
  }
  const parts = ADDRESS_PARTS.map((part) => valueToText(value[part])?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return parts || undefined;
};

const formatRating = (entity: JsonLdEntity): string | undefined =>
  stringified(prop(entity.aggregateRating, "ratingValue"));

const ratingCount = (entity: JsonLdEntity): string | undefined =>
  stringified(
    prop(entity.aggregateRating, "ratingCount") ||
      prop(entity.aggregateRating, "reviewCount")
  );

const jsonLdDate = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? formatDate(value)
    : undefined;

const hostnameMatchesDomain = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

export const detectProvider = (
  url?: string,
  hint?: string
): string | undefined => {
  if (hint) {
    return hint;
  }
  if (!url) {
    return;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostnameMatchesDomain(hostname, "github.com")) {
      return "github";
    }
    if (hostnameMatchesDomain(hostname, "goodreads.com")) {
      return "goodreads";
    }
    if (
      hostnameMatchesDomain(hostname, "amazon.com") ||
      hostnameMatchesDomain(hostname, "amazon.co.uk") ||
      hostnameMatchesDomain(hostname, "amazon.de") ||
      hostnameMatchesDomain(hostname, "amazon.fr") ||
      hostnameMatchesDomain(hostname, "amazon.it") ||
      hostnameMatchesDomain(hostname, "amazon.es") ||
      hostnameMatchesDomain(hostname, "amazon.ca") ||
      hostnameMatchesDomain(hostname, "amazon.com.au") ||
      hostnameMatchesDomain(hostname, "amazon.co.jp") ||
      hostnameMatchesDomain(hostname, "amazon.in")
    ) {
      return "amazon";
    }
    if (hostnameMatchesDomain(hostname, "imdb.com")) {
      return "imdb";
    }
    if (hostnameMatchesDomain(hostname, "netflix.com")) {
      return "netflix";
    }
    if (hostnameMatchesDomain(hostname, "behance.net")) {
      return "behance";
    }
    if (hostnameMatchesDomain(hostname, "dribbble.com")) {
      return "dribbble";
    }
    if (hostnameMatchesDomain(hostname, "spotify.com")) {
      return "spotify";
    }
    if (hostnameMatchesDomain(hostname, "apple.com")) {
      return "apple";
    }
    if (
      hostnameMatchesDomain(hostname, "youtube.com") ||
      hostnameMatchesDomain(hostname, "youtu.be")
    ) {
      return "youtube";
    }
    if (hostnameMatchesDomain(hostname, "medium.com")) {
      return "medium";
    }
    if (hostnameMatchesDomain(hostname, "substack.com")) {
      return "substack";
    }
    return hostname;
  } catch {
    return undefined;
  }
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readRawSelectorEntry = (value: unknown): RawSelectorEntry | undefined => {
  if (!isJsonLdEntity(value)) {
    return;
  }
  const { attributes, text } = value;
  return {
    ...(Array.isArray(attributes)
      ? {
          attributes: attributes.filter(isJsonLdEntity).map((attribute) => ({
            name: optionalString(attribute.name),
            value: optionalString(attribute.value),
          })),
        }
      : {}),
    ...(typeof text === "string" ? { text } : {}),
  };
};

/** Indexes a stored scrape (`linkPreview.raw`) by selector, first result each. */
export const buildRawSelectorMap = (raw: unknown): RawSelectorMap => {
  const map = new Map<string, RawSelectorEntry>();
  if (!Array.isArray(raw)) {
    return map;
  }
  for (const entry of raw) {
    const selector = prop(entry, "selector");
    if (typeof selector !== "string" || !selector) {
      continue;
    }
    const results = prop(entry, "results");
    const first = readRawSelectorEntry(
      Array.isArray(results) ? results[0] : undefined
    );
    if (first) {
      map.set(selector, first);
    }
  }
  return map;
};

export const mergeFacts = (
  target: LinkCategoryDetail[],
  incoming?: LinkCategoryDetail[]
) => {
  if (!incoming || incoming.length === 0) {
    return;
  }
  const seen = new Set(target.map((fact) => `${fact.label}::${fact.value}`));
  for (const fact of incoming) {
    const key = `${fact.label}::${fact.value}`;
    if (!seen.has(key)) {
      target.push(fact);
      seen.add(key);
    }
  }
};

function formatDuration(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return;
  }
  const match = ISO_DURATION_REGEX.exec(value);
  if (!match) {
    return;
  }
  const [, hours, minutes, seconds] = match;
  const parts: string[] = [];
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  if (seconds) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ") || undefined;
}

export const enrichWithStructuredData = (
  category: LinkCategory,
  entities: readonly JsonLdEntity[]
): ProviderEnrichmentResult | null => {
  let imageUrl: string | undefined;
  const facts: LinkCategoryDetail[] = [];
  let raw: Record<string, unknown> | undefined;
  let price: LinkPrice | undefined;

  const applyImage = (entity: JsonLdEntity) => {
    if (!imageUrl) {
      const candidate = normalizeImage(entity.image);
      if (candidate) {
        imageUrl = candidate;
      }
    }
  };

  const addFact = (label: string, value?: string) => {
    if (value) {
      facts.push({ label, value });
    }
  };

  switch (category) {
    case "book": {
      const book = findByType(entities, ["Book"]);
      if (!book) {
        break;
      }
      applyImage(book);
      addFact("Authors", stringArray(book.author).join(", "));
      addFact("Rating", formatRating(book));
      addFact("Reviews", ratingCount(book));
      addFact("Length", stringified(book.numberOfPages || book.bookFormat));
      addFact("Published", jsonLdDate(book.datePublished));
      raw = pickFields(book, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "movie": {
      const movie = findByType(entities, [
        "Movie",
        "VideoObject",
        "CreativeWork",
      ]);
      if (!movie) {
        break;
      }
      applyImage(movie);
      addFact("Rating", formatRating(movie));
      addFact("Votes", ratingCount(movie));
      addFact("Release", jsonLdDate(movie.datePublished || movie.dateCreated));
      raw = pickFields(movie, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "tv": {
      const show = findByType(entities, [
        "TVSeries",
        "TVEpisode",
        "VideoObject",
      ]);
      if (!show) {
        break;
      }
      applyImage(show);
      addFact(
        "Seasons",
        stringified(show.numberOfSeasons || show.seasonNumber)
      );
      addFact("Episodes", stringified(show.numberOfEpisodes));
      addFact(
        "First aired",
        jsonLdDate(show.datePublished || show.dateCreated)
      );
      raw = pickFields(show, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "article":
    case "news": {
      const article = findByType(entities, [
        "NewsArticle",
        "Article",
        "BlogPosting",
      ]);
      if (!article) {
        break;
      }
      applyImage(article);
      addFact("Published", jsonLdDate(article.datePublished));
      const updated = jsonLdDate(article.dateModified);
      if (updated && updated !== jsonLdDate(article.datePublished)) {
        addFact("Updated", updated);
      }
      raw = pickFields(article, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "podcast": {
      const podcast = findByType(entities, [
        "PodcastEpisode",
        "PodcastSeries",
        "AudioObject",
      ]);
      if (!podcast) {
        break;
      }
      applyImage(podcast);
      addFact("Duration", formatDuration(podcast.duration));
      addFact(
        "Series",
        valueToText(podcast.partOfSeries) || valueToText(podcast.isPartOf)
      );
      raw = pickFields(podcast, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "music": {
      const music = findByType(entities, [
        "MusicRecording",
        "MusicAlbum",
        "MusicPlaylist",
      ]);
      if (!music) {
        break;
      }
      applyImage(music);
      addFact(
        "Artist",
        stringArray(music.byArtist || music.creator || music.performer).join(
          ", "
        )
      );
      addFact("Length", formatDuration(music.duration));
      raw = pickFields(music, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "product": {
      const product = findByType(entities, [
        "Product",
        "ProductGroup",
        "Offer",
      ]);
      if (!product) {
        break;
      }
      applyImage(product);
      price = parseStructuredPrice(product) ?? undefined;
      const offerPrice = prop(product.offers, "price");
      if (offerPrice) {
        const currency = prop(product.offers, "priceCurrency") || "";
        addFact("Price", `${offerPrice} ${currency}`.trim());
      } else if (price) {
        addFact("Price", formatLinkPrice(price));
      }
      addFact("Brand", valueToText(product.brand));
      raw = pickFields(product, STRUCTURED_DATA_FIELDS);
      if (raw && Array.isArray(product.hasVariant)) {
        raw.hasVariant = product.hasVariant
          .slice(0, MAX_STORED_VARIANTS)
          .map((variant: unknown) => ({ offers: prop(variant, "offers") }));
      }
      break;
    }
    case "recipe": {
      const recipe = findByType(entities, ["Recipe"]);
      if (!recipe) {
        break;
      }
      applyImage(recipe);
      addFact("Servings", valueToText(recipe.recipeYield));
      const prep = formatDuration(recipe.prepTime);
      const cook = formatDuration(recipe.cookTime);
      const total = formatDuration(recipe.totalTime);
      const timing = [
        prep ? `Prep ${prep}` : null,
        cook ? `Cook ${cook}` : null,
        total ? `Total ${total}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      addFact("Timing", timing || undefined);
      const ingredients = stringArray(recipe.recipeIngredient);
      if (ingredients.length) {
        addFact("Ingredients", ingredients.slice(0, 6).join(", "));
      }
      raw = pickFields(recipe, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "course": {
      const course = findByType(entities, [
        "Course",
        "EducationalOccupationalProgram",
      ]);
      if (!course) {
        break;
      }
      applyImage(course);
      addFact(
        "Provider",
        valueToText(course.provider) || valueToText(course.publisher)
      );
      raw = pickFields(course, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "research": {
      const paper = findByType(entities, [
        "ScholarlyArticle",
        "ResearchArticle",
        "Report",
      ]);
      if (!paper) {
        break;
      }
      applyImage(paper);
      addFact("Authors", stringArray(paper.author).join(", "));
      addFact("Published", jsonLdDate(paper.datePublished));
      raw = pickFields(paper, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "event": {
      const event = findByType(entities, [
        "Event",
        "MusicEvent",
        "BusinessEvent",
      ]);
      if (!event) {
        break;
      }
      applyImage(event);
      const start = jsonLdDate(event.startDate);
      const end = jsonLdDate(event.endDate);
      const dates =
        end && start && start !== end ? `${start} → ${end}` : start || end;
      addFact("Dates", dates);
      addFact(
        "Location",
        valueToText(prop(event.location, "name")) || valueToText(event.location)
      );
      raw = pickFields(event, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "software": {
      const software = findByType(entities, [
        "SoftwareApplication",
        "SoftwareSourceCode",
      ]);
      if (!software) {
        break;
      }
      applyImage(software);
      addFact("Platform", valueToText(software.operatingSystem));
      addFact("Category", valueToText(software.applicationCategory));
      raw = pickFields(software, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "design_portfolio": {
      const creative = findByType(entities, [
        "CreativeWork",
        "CollectionPage",
        "Portfolio",
      ]);
      if (!creative) {
        break;
      }
      applyImage(creative);
      addFact(
        "Creator",
        valueToText(creative.author) || valueToText(creative.creator)
      );
      raw = pickFields(creative, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "place": {
      const place = findByType(entities, PLACE_TYPES);
      if (!place) {
        break;
      }
      applyImage(place);
      // A listing usually describes the home it offers rather than itself.
      const subject = [place, place.about, place.mainEntity, place.itemOffered]
        .filter(isJsonLdEntity)
        .find((candidate) => candidate.address);
      addFact("Address", formatAddress(subject?.address));
      addFact("Cuisine", stringArray(place.servesCuisine).join(", "));
      addFact("Price range", valueToText(place.priceRange));
      addFact("Rating", formatRating(place));
      raw = pickFields(place, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "app": {
      const app = findByType(entities, APP_TYPES);
      if (!app) {
        break;
      }
      applyImage(app);
      addFact("Platform", stringArray(app.operatingSystem).join(", "));
      addFact("Category", valueToText(app.applicationCategory));
      addFact("Rating", formatRating(app));
      raw = pickFields(app, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "game": {
      const game = findByType(entities, ["VideoGame"]);
      if (!game) {
        break;
      }
      applyImage(game);
      addFact(
        "Platform",
        stringArray(game.gamePlatform || game.operatingSystem).join(", ")
      );
      addFact("Genre", stringArray(game.genre).join(", "));
      addFact("Rating", formatRating(game));
      addFact("Released", jsonLdDate(game.datePublished));
      raw = pickFields(game, STRUCTURED_DATA_FIELDS);
      break;
    }
    default:
      break;
  }

  const hasData = imageUrl || facts.length > 0 || raw;
  if (!hasData) {
    return null;
  }

  return {
    imageUrl,
    facts: facts.length > 0 ? facts : undefined,
    ...(price ? { price } : {}),
    raw,
  };
};
