import { internal } from "@teak/convex/_generated/api";
import {
  LINK_CATEGORY_DEFAULT_CONFIDENCE,
  type LinkCategoryMetadata,
} from "@teak/convex/shared";
import {
  fetchRemoteDetails,
  type RemoteDetails,
  remoteSourceFor,
} from "@teak/convex/workflows/steps/categorization/remote/index";
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
  remoteLookupInput,
  type StructuredDataResult,
} from "@teak/convex/workflows/steps/categorization/rules";
import {
  type CardJob,
  guardOf,
  type LoadedCard,
  loadCard,
  markInProgress,
} from "./context";
import { runDecision } from "./decisions";
import {
  fetchLinkPageForCard,
  gunzipBase64,
  storeLinkPreviewImage,
} from "./linkMetadata";
import { archiveRawMetadata, hydrateArchivedMetadata } from "./rawMetadata";

const MAX_FETCH_BODY_SIZE = 250_000;
const METADATA_TTL_MS = 1000 * 60 * 60 * 24 * 30;

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

const MAX_ARXIV_WAIT_MS = 10_000;

/**
 * Waits for one of arXiv's API slots (one request every 3 seconds for the
 * whole deployment); false when the queue is full.
 */
const takeArxivSlot = async (job: CardJob): Promise<boolean> => {
  const slot = await job.deps.convex.mutation(
    internal.workflows.steps.categorization.mutations.takeArxivSlot,
    {}
  );
  if (!slot || slot.retryAfter > MAX_ARXIV_WAIT_MS) {
    return false;
  }
  if (slot.retryAfter > 0) {
    await new Promise((resolve) => setTimeout(resolve, slot.retryAfter));
  }
  return true;
};

const lookUpSiteDetails = async (
  job: CardJob,
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  structuredData: StructuredDataResult | null
): Promise<RemoteDetails | null> => {
  const input = remoteLookupInput(card, classification, structuredData);
  if (!remoteSourceFor(input)) {
    return null;
  }
  return await fetchRemoteDetails(input, {
    pinnedFetch: job.deps.pinnedFetch,
    resolveDns: job.deps.resolveDns,
    takeArxivSlot: () => takeArxivSlot(job),
  });
};

const storeSiteImage = async (
  job: CardJob,
  loaded: LoadedCard,
  metadata: LinkCategoryMetadata,
  remote: RemoteDetails | null
) => {
  const preview = loaded.card.metadata?.linkPreview;
  if (
    !remote?.imageUrl ||
    metadata.imageUrl !== remote.imageUrl ||
    preview?.status !== "success" ||
    preview.imageStorageKey ||
    preview.imageUrl
  ) {
    return;
  }
  return (
    (await storeLinkPreviewImage(
      job,
      loaded,
      remote.imageUrl,
      metadata.sourceUrl
    )) ?? undefined
  );
};

export interface CategorizationResult {
  category: string;
  confidence: number;
  mode: "categorized" | "missing";
}

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

  const save = async (
    metadata: LinkCategoryMetadata,
    previewImage?: Awaited<ReturnType<typeof storeSiteImage>>
  ) => {
    await job.deps.convex.mutation(
      internal.workflows.steps.categorization.mutations.updateCategorization,
      {
        cardId: job.cardId,
        metadata: await archiveRawMetadata(
          job,
          { keyPrefix: loaded.keyPrefix, userId: card.userId },
          "linkCategory",
          metadata
        ),
        ...(previewImage ? { previewImage } : {}),
      },
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

  // Read back first: the page's own audio, in its archived scrape, counts.
  const hydratedCard = await hydrateArchivedMetadata(
    job.env,
    loaded.keyPrefix,
    contextCard
  );
  const classification = classifyLinkCategory(hydratedCard, sourceUrl);
  if (!classification) {
    throw new Error(`Failed to classify link category for card ${job.cardId}`);
  }

  const structuredMeta = existingMetadata?.raw?.structuredMeta;
  const structuredFetchedAt =
    (typeof structuredMeta === "object" &&
    structuredMeta !== null &&
    "fetchedAt" in structuredMeta &&
    typeof structuredMeta.fetchedAt === "number"
      ? structuredMeta.fetchedAt
      : undefined) ?? existingMetadata?.rawStructuredFetchedAt;
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

  const reviewedClassification = await reviewLinkCategoryWithClef(
    job,
    hydratedCard,
    classification,
    sourceUrl,
    structuredData?.entities
  );
  const remote = await lookUpSiteDetails(
    job,
    hydratedCard,
    reviewedClassification,
    structuredData
  );
  const metadata = enrichLinkCategory(hydratedCard, reviewedClassification, {
    remote,
    structuredData,
  });
  return await save(
    metadata,
    await storeSiteImage(job, loaded, metadata, remote)
  );
};
