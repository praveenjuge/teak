import type { LinkCategory, LinkCategoryDetail } from "@teak/convex/shared";
import {
  formatDate,
  type ProviderEnrichmentResult,
  type RawSelectorEntry,
  type RawSelectorMap,
} from "./providers/common";

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
];

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

export const pickFields = (
  value: Record<string, any>,
  fields: string[]
): Record<string, any> => {
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (value[field] !== undefined) {
      result[field] = value[field];
    }
  }
  return result;
};

const matchesType = (candidate: any, types: string[]): boolean => {
  const candidateTypes = toArray(candidate?.["@type"]).map((entry) =>
    typeof entry === "string" ? entry.toLowerCase() : ""
  );
  return types.some((type) => candidateTypes.includes(type.toLowerCase()));
};

const findByType = (
  entities: any[],
  typeCandidates: string[]
): any | undefined =>
  entities.find((entity) => matchesType(entity, typeCandidates));

const stringArray = (value: any): string[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : entry?.name))
      .filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "object" && value.name) {
    return [value.name];
  }
  return [];
};

const valueToText = (value: any): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (!value) {
    return;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "object" && value.name) {
    return value.name;
  }
};

const normalizeImage = (value: any): string | undefined => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") {
      return first;
    }
    if (first?.url) {
      return first.url;
    }
  }
  if (value?.url) {
    return value.url;
  }
};

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
    // Invalid URLs fall through to the caller's default handling.
  }
};

export const buildRawSelectorMap = (
  raw?: Array<{ selector: string; results?: RawSelectorEntry[] }>
): RawSelectorMap => {
  const map = new Map<string, RawSelectorEntry>();
  if (!raw) {
    return map;
  }
  for (const entry of raw) {
    if (!entry?.selector) {
      continue;
    }
    const first = entry.results?.[0];
    if (first) {
      map.set(entry.selector, first);
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

function formatDuration(value: string | undefined): string | undefined {
  if (!value) {
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
  entities: any[]
): ProviderEnrichmentResult | null => {
  let imageUrl: string | undefined;
  const facts: LinkCategoryDetail[] = [];
  let raw: Record<string, unknown> | undefined;

  const applyImage = (entity: any) => {
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
      addFact("Rating", book.aggregateRating?.ratingValue?.toString());
      addFact(
        "Reviews",
        (
          book.aggregateRating?.ratingCount || book.aggregateRating?.reviewCount
        )?.toString()
      );
      addFact("Length", (book.numberOfPages || book.bookFormat)?.toString());
      addFact("Published", formatDate(book.datePublished));
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
      addFact("Rating", movie.aggregateRating?.ratingValue?.toString());
      addFact(
        "Votes",
        (
          movie.aggregateRating?.ratingCount ||
          movie.aggregateRating?.reviewCount
        )?.toString()
      );
      addFact("Release", formatDate(movie.datePublished || movie.dateCreated));
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
        (show.numberOfSeasons || show.seasonNumber)?.toString()
      );
      addFact("Episodes", show.numberOfEpisodes?.toString());
      addFact(
        "First aired",
        formatDate(show.datePublished || show.dateCreated)
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
      addFact("Published", formatDate(article.datePublished));
      const updated = formatDate(article.dateModified);
      if (updated && updated !== formatDate(article.datePublished)) {
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
      const product = findByType(entities, ["Product", "Offer"]);
      if (!product) {
        break;
      }
      applyImage(product);
      if (product.offers?.price) {
        const currency = product.offers.priceCurrency || "";
        addFact("Price", `${product.offers.price} ${currency}`.trim());
      }
      addFact("Brand", valueToText(product.brand));
      raw = pickFields(product, STRUCTURED_DATA_FIELDS);
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
      addFact("Published", formatDate(paper.datePublished));
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
      const start = formatDate(event.startDate);
      const end = formatDate(event.endDate);
      const dates =
        end && start && start !== end ? `${start} → ${end}` : start || end;
      addFact("Dates", dates);
      addFact(
        "Location",
        valueToText(event.location?.name) || valueToText(event.location)
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
    raw,
  };
};
