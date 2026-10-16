import { internal } from "@teak/convex/_generated/api";
import {
  LINK_CATEGORY_DEFAULT_CONFIDENCE,
  type LinkCategoryMetadata,
} from "@teak/convex/shared";
import {
  applyLinkCategoryDecision,
  type CategorizationContextCard,
  type CategoryClassificationResult,
  classifyLinkCategory,
  enrichLinkCategory,
  linkCategoryDecisionParams,
  normalizeUrlForComparison,
  parseStructuredData,
  projectCategorizationSnapshot,
  readLinkCategoryReply,
  type StructuredDataResult,
} from "@teak/convex/workflows/steps/categorization/rules";
import { type CardJob, guardOf, loadCard, markInProgress } from "./context";
import { runDecision } from "./decisions";
import { fetchLinkPageForCard, gunzipBase64 } from "./linkMetadata";
import { hydrateArchivedMetadata } from "./rawMetadata";

// Categorization: what kind of thing a link is (a recipe, a repo, a
// product) and the facts its page states, from the URL, the preview and the
// page's JSON-LD (the rules in @teak/convex/.../categorization/rules). Clef
// reviews a category the rules only guessed.

const MAX_FETCH_BODY_SIZE = 250_000;
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

/**
 * Lets Clef pick the category when the resolver only guessed it. The rules'
 * classification stands when Clef is unsure, the call fails or AI is off.
 */
const reviewLinkCategoryWithClef = async (
  job: CardJob,
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  sourceUrl: string,
  structuredEntities: unknown
): Promise<CategoryClassificationResult> => {
  const params = linkCategoryDecisionParams(
    card,
    classification,
    sourceUrl,
    structuredEntities
  );
  if (!params) {
    return classification;
  }
  const result = await runDecision(job, {
    op: "decide-link-category",
    params,
    read: readLinkCategoryReply,
    userId: card.userId,
  });
  return applyLinkCategoryDecision(classification, result);
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
  // "Refresh details": the 30-day cache is ignored, so the link is
  // classified again and its page's JSON-LD read again.
  const refresh = job.refresh === true;

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
    !refresh &&
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
    (refresh ||
      !(
        (existingMetadata?.raw?.structured ??
          existingMetadata?.rawHasStructured) ||
        structuredFresh
      ));
  const structuredData = shouldFetchStructured
    ? await fetchStructuredData(job, sourceUrl)
    : null;

  const hydratedCard = await hydrateArchivedMetadata(
    job.env,
    loaded.keyPrefix,
    contextCard
  );
  const reviewedClassification = await reviewLinkCategoryWithClef(
    job,
    hydratedCard,
    classification,
    sourceUrl,
    structuredData?.entities
  );
  return await save(
    enrichLinkCategory(hydratedCard, reviewedClassification, {
      structuredData,
    })
  );
};
