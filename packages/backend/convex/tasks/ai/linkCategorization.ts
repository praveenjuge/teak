import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  LINK_CATEGORY_DEFAULT_CONFIDENCE,
  LINK_CATEGORY_LABELS,
  type LinkCategory,
  type LinkCategoryMetadata,
  type LinkCategoryDetail,
} from "@teak/shared";
import { linkCategoryClassificationSchema } from "./schemas";
import type { Id } from "../../_generated/dataModel";

const MAX_FETCH_BODY_SIZE = 250_000;
const STRUCTURED_DATA_MAX_ITEMS = 8;
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

export interface CategorizationContextCard {
  _id: Id<"cards">;
  type: string;
  url?: string;
  content?: string;
  notes?: string;
  metadata?: any;
  metadataStatus?: string;
  tags?: string[];
  processingStatus?: any;
}

export interface CategoryClassificationResult {
  category: LinkCategory;
  confidence: number;
  providerHint?: string;
  tags?: string[];
}

const safeTrim = (value: string | undefined, maxLength = 4096): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
};

const buildCategorizationPrompt = (card: CategorizationContextCard): string => {
  const sections: string[] = [];

  if (card.url) {
    sections.push(`URL: ${card.url}`);
    try {
      const url = new URL(card.url);
      sections.push(`Domain: ${url.hostname}`);
      sections.push(`Pathname: ${url.pathname}`);
    } catch {
      // ignore parsing errors
    }
  }

  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  if (linkPreview) {
    const details = {
      title: linkPreview.title,
      description: linkPreview.description,
      siteName: linkPreview.siteName,
      author: linkPreview.author,
      publisher: linkPreview.publisher,
      publishedAt: linkPreview.publishedAt,
      imageUrl: linkPreview.imageUrl,
    };
    sections.push(`Link preview metadata: ${JSON.stringify(details, null, 2)}`);
  }

  if (card.tags?.length) {
    sections.push(`Existing tags: ${card.tags.join(", ")}`);
  }

  const combinedNotes = [card.content, card.notes]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n\n");
  if (combinedNotes) {
    const trimmed = safeTrim(combinedNotes, 4000);
    if (trimmed) {
      sections.push(`User-provided content:\n${trimmed}`);
    }
  }

  sections.push(`Select the best fitting category from this list: ${Object.values(LINK_CATEGORY_LABELS).join(", ")}.`);

  return sections.join("\n\n");
};

export const classifyLinkCategory = async (
  card: CategorizationContextCard
): Promise<CategoryClassificationResult | null> => {
  if (!card.url) {
    return null;
  }

  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an assistant that classifies URLs into content categories. Only respond with the requested JSON schema.

Categories you may choose from:
${Object.entries(LINK_CATEGORY_LABELS)
        .map(([key, label]) => `- ${label} (${key})`)
        .join("\n")}

Pick the category that best describes the main subject of the URL. Use provider hints when obvious (e.g. github.com → software, imdb.com → movie).`,
      prompt: buildCategorizationPrompt(card),
      schema: linkCategoryClassificationSchema,
    });

    const { category, confidence, providerHint, tags } = result.object;
    return {
      category,
      confidence: confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE,
      providerHint,
      tags,
    };
  } catch (error) {
    console.error(`[categorize] Failed to classify link for card ${card._id}:`, error);
    return null;
  }
};

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const pickFields = (value: Record<string, any>, fields: string[]): Record<string, any> => {
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (value[field] !== undefined) {
      result[field] = value[field];
    }
  }
  return result;
};

interface StructuredDataResult {
  entities: any[];
}

const parseStructuredData = (html: string): StructuredDataResult => {
  const entities: any[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = scriptRegex.exec(html)) !== null) {
    const jsonText = match[1]?.trim();
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of values) {
        if (item && typeof item === "object") {
          const fingerprint = JSON.stringify(pickFields(item, ["@type", "name", "url"]));
          if (!seen.has(fingerprint)) {
            seen.add(fingerprint);
            entities.push(item);
            if (entities.length >= STRUCTURED_DATA_MAX_ITEMS) {
              return { entities };
            }
          }
        }
      }
    } catch (error) {
      console.warn("[categorize] Failed to parse JSON-LD block", error);
    }
  }

  return { entities };
};

const fetchStructuredData = async (url: string): Promise<StructuredDataResult | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TeakBot/1.0 (+https://teak)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(`[categorize] Structured data fetch failed for ${url} (${response.status})`);
      return null;
    }

    const text = await response.text();
    if (!text) {
      return null;
    }

    const truncated = text.length > MAX_FETCH_BODY_SIZE
      ? text.slice(0, MAX_FETCH_BODY_SIZE)
      : text;

    return parseStructuredData(truncated);
  } catch (error) {
    console.warn(`[categorize] Structured data fetch error for ${url}:`, error);
    return null;
  }
};

const matchesType = (candidate: any, types: string[]): boolean => {
  const candidateTypes = toArray(candidate?.["@type"]).map((entry) =>
    typeof entry === "string" ? entry.toLowerCase() : ""
  );
  return types.some((type) => candidateTypes.includes(type.toLowerCase()));
};

const findByType = (entities: any[], typeCandidates: string[]): any | undefined => {
  return entities.find((entity) => matchesType(entity, typeCandidates));
};

const stringArray = (value: any): string[] => {
  if (!value) return [];
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
  if (typeof value === "string") return value;
  if (!value) return undefined;
  if (typeof value === "number") return value.toString();
  if (typeof value === "object" && value.name) return value.name;
  return undefined;
};

const normalizeImage = (value: any): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") return first;
    if (first?.url) return first.url;
  }
  if (value?.url) return value.url;
  return undefined;
};

const detectProvider = (url?: string, hint?: string): string | undefined => {
  if (hint) return hint;
  if (!url) return undefined;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("github.com")) return "github";
    if (hostname.includes("goodreads.com")) return "goodreads";
    if (hostname.includes("amazon.")) return "amazon";
    if (hostname.includes("imdb.com")) return "imdb";
    if (hostname.includes("netflix.com")) return "netflix";
    if (hostname.includes("behance.net")) return "behance";
    if (hostname.includes("dribbble.com")) return "dribbble";
    if (hostname.includes("spotify.com")) return "spotify";
    if (hostname.includes("apple.com")) return "apple";
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube";
    if (hostname.includes("medium.com")) return "medium";
    if (hostname.includes("substack.com")) return "substack";
    return hostname;
  } catch {
    return undefined;
  }
};

type RawSelectorEntry = {
  text?: string;
  attributes?: Array<{ name?: string; value?: string }>;
};

type RawSelectorMap = Map<string, RawSelectorEntry>;

const buildRawSelectorMap = (
  raw?: Array<{ selector: string; results?: RawSelectorEntry[] }>
): RawSelectorMap => {
  const map = new Map<string, RawSelectorEntry>();
  if (!raw) {
    return map;
  }
  for (const entry of raw) {
    if (!entry?.selector) continue;
    const first = entry.results?.[0];
    if (first) {
      map.set(entry.selector, first);
    }
  }
  return map;
};

const normalizeWhitespace = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getRawText = (map: RawSelectorMap, selector: string): string | undefined => {
  return normalizeWhitespace(map.get(selector)?.text);
};

const getRawAttribute = (
  map: RawSelectorMap,
  selector: string,
  attribute: string
): string | undefined => {
  const entry = map.get(selector);
  if (!entry?.attributes) {
    return undefined;
  }
  const needle = attribute.toLowerCase();
  for (const attr of entry.attributes) {
    if (!attr?.name) continue;
    if (attr.name.toLowerCase() === needle) {
      return normalizeWhitespace(attr.value);
    }
  }
  return undefined;
};

const extractNumericToken = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return undefined;
  const token = trimmed
    .split(" ")
    .find((segment) => /\d/.test(segment.replace(/[,\.]/g, "")));
  return token ?? trimmed;
};

const parseCountToNumber = (value?: string): number | undefined => {
  const token = extractNumericToken(value);
  if (!token) return undefined;
  const lower = token.toLowerCase();
  const multiplier = lower.endsWith("k")
    ? 1_000
    : lower.endsWith("m")
    ? 1_000_000
    : 1;
  const numericPart = multiplier === 1 ? lower : lower.slice(0, -1);
  const parsed = Number.parseFloat(numericPart.replace(/,/g, ""));
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return Math.round(parsed * multiplier);
};

const formatCountString = (value?: string): string | undefined => {
  const number = parseCountToNumber(value);
  if (number !== undefined) {
    return number.toLocaleString("en-US");
  }
  return normalizeWhitespace(value);
};

const formatRating = (value?: string): string | undefined => {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) {
    return normalizeWhitespace(value);
  }
  return numeric.toFixed(2);
};

const mergeFacts = (
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

interface ProviderEnrichmentResult {
  imageUrl?: string;
  facts?: LinkCategoryDetail[];
  raw?: Record<string, unknown>;
}

const enrichGithubFromRaw = (
  rawMap: RawSelectorMap,
): ProviderEnrichmentResult | null => {
  const stars = formatCountString(getRawText(rawMap, "a[href$='/stargazers']"));
  const forks = formatCountString(
    getRawText(rawMap, "a[href$='/network/members']")
  );
  const watchers = formatCountString(
    getRawText(rawMap, "a[href$='/watchers']")
  );
  const language = getRawText(rawMap, "span[itemprop='programmingLanguage']");
  const updatedRaw = getRawText(rawMap, "relative-time");

  const facts: LinkCategoryDetail[] = [];
  if (stars) facts.push({ label: "Stars", value: stars });
  if (forks) facts.push({ label: "Forks", value: forks });
  if (watchers) facts.push({ label: "Watchers", value: watchers });
  if (language) {
    facts.push({ label: "Language", value: language });
  }
  if (updatedRaw) {
    const formatted = normalizeWhitespace(updatedRaw.replace(/^on\s+/i, ""));
    if (formatted) {
      facts.push({ label: "Updated", value: formatted });
    }
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    facts,
    raw: {
      stars: stars ?? null,
      forks: forks ?? null,
      watchers: watchers ?? null,
      language: language ?? null,
      updated: updatedRaw ?? null,
    },
  };
};

const enrichGoodreadsFromRaw = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const avg = formatRating(
    getRawAttribute(rawMap, "meta[property='books:rating:average']", "content")
  );
  const count = formatCountString(
    getRawAttribute(rawMap, "meta[property='books:rating:count']", "content")
  );
  const isbn = getRawAttribute(
    rawMap,
    "meta[property='books:isbn']",
    "content"
  );

  const facts: LinkCategoryDetail[] = [];
  if (avg) {
    facts.push({ label: "Average rating", value: `${avg} / 5` });
  }
  if (count) {
    facts.push({ label: "Ratings", value: count });
  }
  if (isbn) {
    facts.push({ label: "ISBN", value: isbn });
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    facts,
    raw: {
      ratingAverage: avg ?? null,
      ratingCount: count ?? null,
      isbn: isbn ?? null,
    },
  };
};

const enrichAmazonFromRaw = (
  rawMap: RawSelectorMap,
): ProviderEnrichmentResult | null => {
  const priceText =
    getRawText(rawMap, "#priceblock_ourprice") ||
    getRawText(rawMap, "#priceblock_dealprice") ||
    getRawText(rawMap, ".a-price .a-offscreen") ||
    normalizeWhitespace(
      getRawAttribute(rawMap, "meta[name='price']", "content") ||
        getRawAttribute(rawMap, "meta[property='og:price:amount']", "content")
    );
  const currency = getRawAttribute(
    rawMap,
    "meta[property='og:price:currency']",
    "content"
  );

  if (!priceText && !currency) {
    return null;
  }

  const priceLabel = currency
    ? `${priceText ?? ""} ${currency}`.trim()
    : priceText;

  return {
    facts: priceLabel ? [{ label: "Price", value: priceLabel }] : undefined,
    raw: {
      price: priceText ?? null,
      currency: currency ?? null,
    },
  };
};

const enrichImdbFromRaw = (
  rawMap: RawSelectorMap
): ProviderEnrichmentResult | null => {
  const rating = formatRating(
    getRawAttribute(rawMap, "meta[name='imdb:rating']", "content") ||
      getRawText(
        rawMap,
        "span[data-testid='hero-rating-bar__aggregate-rating__score']"
      )
  );
  const votes = formatCountString(
    getRawAttribute(rawMap, "meta[name='imdb:votes']", "content")
  );
  const runtime = getRawText(
    rawMap,
    "span[data-testid='title-techspec_runtime'] span"
  );
  const releaseDateRaw = getRawAttribute(
    rawMap,
    "meta[property='video:release_date']",
    "content"
  );
  const releaseDate = formatDate(releaseDateRaw ?? "");

  const facts: LinkCategoryDetail[] = [];
  if (rating) {
    facts.push({ label: "IMDb rating", value: `${rating} / 10` });
  }
  if (votes) {
    facts.push({ label: "Votes", value: votes });
  }
  if (runtime) {
    facts.push({ label: "Runtime", value: runtime });
  }
  if (releaseDate) {
    facts.push({ label: "Released", value: releaseDate });
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    facts,
    raw: {
      rating: rating ?? null,
      votes: votes ?? null,
      runtime: runtime ?? null,
      releaseDate: releaseDateRaw ?? null,
    },
  };
};

const enrichProvider = (
  provider: string | undefined,
  category: LinkCategory,
  rawMap: RawSelectorMap,
): ProviderEnrichmentResult | null => {
  if (!provider) {
    return null;
  }

  switch (provider) {
    case "github":
      if (category === "software") {
        return enrichGithubFromRaw(rawMap);
      }
      return null;
    case "goodreads":
      if (category === "book") {
        return enrichGoodreadsFromRaw(rawMap);
      }
      return null;
    case "amazon":
      if (category === "product" || category === "book") {
        return enrichAmazonFromRaw(rawMap);
      }
      return null;
    case "imdb":
      if (category === "movie" || category === "tv") {
        return enrichImdbFromRaw(rawMap);
      }
      return null;
    case "netflix":
      // Netflix pages typically hide metadata from OG tags; rely on link preview.
      return null;
    default:
      return null;
  }
};

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value);
  if (!match) return undefined;
  const [, hours, minutes, seconds] = match;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(" ") || undefined;
}

const enrichWithStructuredData = (
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
      if (!book) break;
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
      const movie = findByType(entities, ["Movie", "VideoObject", "CreativeWork"]);
      if (!movie) break;
      applyImage(movie);
      addFact("Rating", movie.aggregateRating?.ratingValue?.toString());
      addFact(
        "Votes",
        (
          movie.aggregateRating?.ratingCount || movie.aggregateRating?.reviewCount
        )?.toString()
      );
      addFact("Release", formatDate(movie.datePublished || movie.dateCreated));
      raw = pickFields(movie, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "tv": {
      const show = findByType(entities, ["TVSeries", "TVEpisode", "VideoObject"]);
      if (!show) break;
      applyImage(show);
      addFact("Seasons", (show.numberOfSeasons || show.seasonNumber)?.toString());
      addFact("Episodes", show.numberOfEpisodes?.toString());
      addFact("First aired", formatDate(show.datePublished || show.dateCreated));
      raw = pickFields(show, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "article":
    case "news": {
      const article = findByType(entities, ["NewsArticle", "Article", "BlogPosting"]);
      if (!article) break;
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
      const podcast = findByType(entities, ["PodcastEpisode", "PodcastSeries", "AudioObject"]);
      if (!podcast) break;
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
      const music = findByType(entities, ["MusicRecording", "MusicAlbum", "MusicPlaylist"]);
      if (!music) break;
      applyImage(music);
      addFact(
        "Artist",
        stringArray(music.byArtist || music.creator || music.performer).join(", ")
      );
      addFact("Length", formatDuration(music.duration));
      raw = pickFields(music, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "product": {
      const product = findByType(entities, ["Product", "Offer"]);
      if (!product) break;
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
      if (!recipe) break;
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
      const course = findByType(entities, ["Course", "EducationalOccupationalProgram"]);
      if (!course) break;
      applyImage(course);
      addFact(
        "Provider",
        valueToText(course.provider) || valueToText(course.publisher)
      );
      raw = pickFields(course, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "research": {
      const paper = findByType(entities, ["ScholarlyArticle", "ResearchArticle", "Report"]);
      if (!paper) break;
      applyImage(paper);
      addFact("Authors", stringArray(paper.author).join(", "));
      addFact("Published", formatDate(paper.datePublished));
      raw = pickFields(paper, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "event": {
      const event = findByType(entities, ["Event", "MusicEvent", "BusinessEvent"]);
      if (!event) break;
      applyImage(event);
      const start = formatDate(event.startDate);
      const end = formatDate(event.endDate);
      const dates = end && start && start !== end ? `${start} → ${end}` : start || end;
      addFact("Dates", dates);
      addFact(
        "Location",
        valueToText(event.location?.name) || valueToText(event.location)
      );
      raw = pickFields(event, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "software": {
      const software = findByType(entities, ["SoftwareApplication", "SoftwareSourceCode"]);
      if (!software) break;
      applyImage(software);
      addFact("Platform", valueToText(software.operatingSystem));
      addFact("Category", valueToText(software.applicationCategory));
      raw = pickFields(software, STRUCTURED_DATA_FIELDS);
      break;
    }
    case "design_portfolio": {
      const creative = findByType(entities, ["CreativeWork", "CollectionPage", "Portfolio"]);
      if (!creative) break;
      applyImage(creative);
      addFact("Creator", valueToText(creative.author) || valueToText(creative.creator));
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

export const enrichLinkCategory = async (
  card: CategorizationContextCard,
  classification: CategoryClassificationResult
): Promise<LinkCategoryMetadata> => {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const sourceUrl = card.url || linkPreview?.finalUrl || linkPreview?.url || "";
  let imageUrl = linkPreview?.imageUrl;
  const facts: LinkCategoryDetail[] = [];

  const provider = detectProvider(sourceUrl, classification.providerHint);

  let raw: Record<string, unknown> | undefined = card.metadata?.linkCategory?.raw
    ? { ...card.metadata.linkCategory.raw }
    : undefined;

  const rawMap = buildRawSelectorMap(linkPreview?.raw);
  const providerEnrichment = enrichProvider(
    provider,
    classification.category,
    rawMap
  );

  if (providerEnrichment) {
    if (providerEnrichment.imageUrl && !imageUrl) {
      imageUrl = providerEnrichment.imageUrl;
    }
    mergeFacts(facts, providerEnrichment.facts);
  }
  if (provider && (providerEnrichment?.raw || !raw?.provider)) {
    const previousProvider =
      (raw?.provider as Record<string, unknown> | undefined) ?? undefined;
    raw = {
      ...(raw ?? {}),
      provider: {
        ...(previousProvider ?? {}),
        name: provider,
        ...(providerEnrichment?.raw ?? {}),
      },
    };
  } else if (providerEnrichment?.raw) {
    raw = {
      ...(raw ?? {}),
      provider: providerEnrichment.raw,
    };
  }

  const hasStructuredData = raw && Object.prototype.hasOwnProperty.call(raw, "structured");
  const shouldFetchStructured = !!sourceUrl && !hasStructuredData;

  if (shouldFetchStructured) {
    const structured = await fetchStructuredData(sourceUrl);
    if (structured?.entities?.length) {
      const enriched = enrichWithStructuredData(
        classification.category,
        structured.entities
      );
      if (enriched) {
        if (enriched.imageUrl && !imageUrl) {
          imageUrl = enriched.imageUrl;
        }
        mergeFacts(facts, enriched.facts);
        raw = {
          ...(raw ?? {}),
          structured: enriched.raw,
        };
      }
    }
  }

  const metadata: LinkCategoryMetadata = {
    category: classification.category,
    confidence: classification.confidence,
    detectedProvider: provider,
    fetchedAt: Date.now(),
    sourceUrl,
    raw,
  };

  if (imageUrl) {
    metadata.imageUrl = imageUrl;
  }
  if (facts.length > 0) {
    metadata.facts = facts;
  }

  return metadata;
};
