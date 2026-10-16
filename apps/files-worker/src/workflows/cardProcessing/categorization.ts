import { internal } from "@teak/convex/_generated/api";
import {
  isLinkCategory,
  LINK_CATEGORY_DEFAULT_CONFIDENCE,
  type LinkCategory,
  type LinkCategoryDetail,
  type LinkCategoryMetadata,
  type LinkPrice,
  parseStructuredPrice,
  resolveLinkCategory,
} from "@teak/convex/shared";
import {
  buildRawSelectorMap,
  detectProvider,
  enrichWithStructuredData,
  mergeFacts,
  pickFields,
} from "@teak/convex/workflows/steps/categorization/enrichment";
import { enrichProvider } from "@teak/convex/workflows/steps/categorization/providers/index";
import { type CardJob, guardOf, loadCard, markInProgress } from "./context";
import { fetchLinkPageForCard, gunzipBase64 } from "./linkMetadata";
import { hydrateArchivedMetadata } from "./rawMetadata";

// Categorization: what kind of thing a link is (a recipe, a repo, a
// product) and the facts its page states, from the URL, the preview and the
// page's JSON-LD.

const MAX_FETCH_BODY_SIZE = 250_000;
const PREVIEW_HINT_CONFIDENCE = 0.95;
const STRUCTURED_DATA_MAX_ITEMS = 8;

const TRAILING_SLASH_REGEX = /\/+$/;

export interface CategorizationContextCard {
  _id: string;
  content?: string;
  metadata?: any;
  metadataStatus?: string;
  notes?: string;
  processingStatus?: any;
  tags?: string[];
  type: string;
  url?: string;
  userId?: string;
}

export interface CategoryClassificationResult {
  category: LinkCategory;
  confidence: number;
  providerHint?: string;
  reason?: string;
}

export const projectCategorizationSnapshot = (
  card: CategorizationContextCard
): CategorizationContextCard => {
  const preview = card.metadata?.linkPreview;
  return {
    _id: card._id,
    userId: card.userId,
    type: card.type,
    url: card.url,
    metadata: {
      linkCategory: card.metadata?.linkCategory,
      linkPreview: preview
        ? {
            status: preview.status,
            url: preview.url,
            finalUrl: preview.finalUrl,
            title: preview.title,
            description: preview.description,
            siteName: preview.siteName,
            imageUrl: preview.imageUrl,
            raw: preview.raw,
            rawStorageKey: preview.rawStorageKey,
            rawSha256: preview.rawSha256,
            categoryHint: preview.categoryHint,
          }
        : undefined,
    },
  };
};

export const normalizeUrlForComparison = (
  value: string | undefined
): string | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    const params = url.searchParams;
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "mkt_tok",
    ];
    for (const param of trackingParams) {
      params.delete(param);
    }
    url.search = params.toString();
    url.pathname = url.pathname.replace(TRAILING_SLASH_REGEX, "");
    return url.toString();
  } catch {
    return value.trim() || null;
  }
};

export const classifyLinkCategory = (
  card: CategorizationContextCard,
  sourceUrl?: string
): CategoryClassificationResult | null => {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const targetUrl =
    sourceUrl || card.url || linkPreview?.finalUrl || linkPreview?.url || "";

  if (!targetUrl) {
    return null;
  }

  const resolution = resolveLinkCategory(targetUrl, {
    siteName: linkPreview?.siteName,
    title: linkPreview?.title || linkPreview?.description,
  });

  // A post confirmed by its site's API (a Mastodon status on any instance,
  // say) outranks what the URL alone suggests.
  const hint = linkPreview?.categoryHint;
  if (typeof hint === "string" && isLinkCategory(hint)) {
    return {
      category: hint,
      confidence: PREVIEW_HINT_CONFIDENCE,
      providerHint: resolution.provider,
      reason: "preview_hint",
    };
  }

  return {
    category: resolution.category,
    confidence: resolution.confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE,
    providerHint: resolution.provider,
    reason: resolution.reason,
  };
};

export interface StructuredDataResult {
  entities: any[];
  meta?: {
    etag?: string | null;
    lastModified?: string | null;
    fetchedAt: number;
  };
}

export const parseStructuredData = (html: string): StructuredDataResult => {
  const entities: any[] = [];
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const seen = new Set<string>();

  for (
    let match = scriptRegex.exec(html);
    match !== null;
    match = scriptRegex.exec(html)
  ) {
    const jsonText = match[1]?.trim();
    if (!jsonText) {
      continue;
    }
    try {
      const parsed = JSON.parse(jsonText);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of values) {
        if (item && typeof item === "object") {
          const fingerprint = JSON.stringify(
            pickFields(item, ["@type", "name", "url"])
          );
          if (!seen.has(fingerprint)) {
            seen.add(fingerprint);
            entities.push(item);
            if (entities.length >= STRUCTURED_DATA_MAX_ITEMS) {
              return { entities };
            }
          }
        }
      }
    } catch {}
  }

  return { entities };
};

export const enrichLinkCategory = (
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  options: {
    /** JSON-LD read from the page this run, or null when it was not read. */
    structuredData: StructuredDataResult | null;
  }
): LinkCategoryMetadata => {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const sourceUrl = card.url || linkPreview?.finalUrl || linkPreview?.url || "";
  let imageUrl = linkPreview?.imageUrl;
  const facts: LinkCategoryDetail[] = [];

  const provider = detectProvider(sourceUrl, classification.providerHint);

  let raw: Record<string, unknown> | undefined = card.metadata?.linkCategory
    ?.raw
    ? { ...card.metadata.linkCategory.raw }
    : undefined;

  const rawMap = buildRawSelectorMap(linkPreview?.raw);
  const providerEnrichment = enrichProvider(
    provider,
    classification.category,
    rawMap,
    (classification.confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE) < 0.6
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

  const structured = options.structuredData;

  let structuredPrice: LinkPrice | undefined;
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
      structuredPrice = enriched.price;
      raw = {
        ...(raw ?? {}),
        structured: enriched.raw,
        structuredMeta: structured?.meta,
      };
    }
  } else if (classification.category === "product" && raw?.structured) {
    // JSON-LD read on an earlier pass and not fetched again.
    structuredPrice = parseStructuredPrice(raw.structured) ?? undefined;
  }

  // The page's JSON-LD states the price more reliably than its selectors.
  const price = structuredPrice ?? providerEnrichment?.price;

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
  if (price) {
    metadata.price = price;
  }

  return metadata;
};

const METADATA_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * JSON-LD from the link's page, read from the same `fetch-link-page` result
 * the preview used (the op keeps it for a day). Null when the page cannot be
 * read.
 */
const fetchStructuredData = async (
  job: CardJob,
  url: string
): Promise<StructuredDataResult | null> => {
  try {
    const outcome = await fetchLinkPageForCard(job, url);
    if (outcome.kind !== "ok" || !outcome.data.fetched) {
      return null;
    }
    const html = await gunzipBase64(outcome.data.htmlGzipBase64);
    if (!html) {
      return null;
    }
    const parsed = parseStructuredData(
      html.length > MAX_FETCH_BODY_SIZE
        ? html.slice(0, MAX_FETCH_BODY_SIZE)
        : html
    );
    parsed.meta = { fetchedAt: Date.now() };
    return parsed;
  } catch {
    return null;
  }
};

export interface CategorizationResult {
  category: string;
  confidence: number;
  mode: "categorized" | "missing";
}

/**
 * Classifies a link card's category, reads its page's structured data when
 * the stored copy is missing or stale, and saves the merged result.
 */
export const categorizeLink = async (
  job: CardJob
): Promise<CategorizationResult> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return { category: "other", confidence: 0, mode: "missing" };
  }
  const { card } = loaded;
  if (card.type !== "link") {
    throw new Error(
      `Card ${job.cardId} is not a link card (type: ${card.type})`
    );
  }
  await markInProgress(job, ["categorize"]);

  const contextCard = projectCategorizationSnapshot(
    card as unknown as CategorizationContextCard
  );
  const linkPreview =
    contextCard.metadata?.linkPreview?.status === "success"
      ? contextCard.metadata.linkPreview
      : undefined;
  const rawSourceUrl =
    contextCard.url || linkPreview?.finalUrl || linkPreview?.url || "";
  const sourceUrl = normalizeUrlForComparison(rawSourceUrl) || rawSourceUrl;
  const existingMetadata = contextCard.metadata?.linkCategory ?? undefined;
  const metadataFresh =
    existingMetadata?.fetchedAt &&
    Date.now() - existingMetadata.fetchedAt < METADATA_TTL_MS;
  const cachedSourceUrl =
    normalizeUrlForComparison(existingMetadata?.sourceUrl) ||
    existingMetadata?.sourceUrl;

  const save = async (metadata: LinkCategoryMetadata) => {
    await job.deps.convex.mutation(
      internal.workflows.steps.categorization.mutations.updateCategorization,
      { cardId: job.cardId, metadata },
      guardOf(job)
    );
    return {
      category: metadata.category,
      confidence: metadata.confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE,
      mode: "categorized" as const,
    };
  };

  if (
    existingMetadata?.category &&
    sourceUrl &&
    cachedSourceUrl &&
    sourceUrl === cachedSourceUrl &&
    metadataFresh
  ) {
    return await save(existingMetadata);
  }

  const classification = classifyLinkCategory(contextCard, sourceUrl);
  if (!classification) {
    throw new Error(`Failed to classify link category for card ${job.cardId}`);
  }

  const structuredFetchedAt =
    existingMetadata?.raw?.structuredMeta?.fetchedAt ??
    existingMetadata?.rawStructuredFetchedAt;
  const structuredFresh =
    structuredFetchedAt && Date.now() - structuredFetchedAt < METADATA_TTL_MS;
  const shouldFetchStructured =
    !!sourceUrl &&
    !(
      existingMetadata?.raw?.structured ?? existingMetadata?.rawHasStructured
    ) &&
    !structuredFresh;
  const structuredData = shouldFetchStructured
    ? await fetchStructuredData(job, sourceUrl)
    : null;

  return await save(
    enrichLinkCategory(
      await hydrateArchivedMetadata(job.env, loaded.keyPrefix, contextCard),
      classification,
      { structuredData }
    )
  );
};
