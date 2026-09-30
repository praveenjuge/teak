"use node";

import { lookup } from "node:dns/promises";
import {
  LINK_CATEGORY_DEFAULT_CONFIDENCE,
  type LinkCategory,
  type LinkCategoryDetail,
  type LinkCategoryMetadata,
  resolveLinkCategory,
} from "@teak/convex/shared";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  type DnsResolver,
  readBodyWithLimit,
  safeFetch,
} from "../../../linkMetadata/ssrf";
import { TELEMETRY_OPERATIONS } from "../../../shared/telemetry";
import type { Id } from "../../../shared/types";
import { hydrateArchivedMetadata } from "../../../storage/rawMetadata";
import {
  archiveWorkflowValue,
  hydrateWorkflowValue,
} from "../../../storage/workflowArtifacts";
import { withBackendSpan } from "../../../telemetry/sentry";
import { pinnedFetch } from "../pinnedFetch";
import {
  buildRawSelectorMap,
  detectProvider,
  enrichWithStructuredData,
  mergeFacts,
  pickFields,
} from "./enrichment";
import { enrichProvider } from "./providers";

// Node runtime DNS resolver injected into the SSRF guard (keeps the guard free
// of Node built-ins so it bundles for any Convex runtime).
const resolveDns: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const MAX_FETCH_BODY_SIZE = 250_000;
const STRUCTURED_DATA_MAX_ITEMS = 8;

// Top-level regex patterns for performance
const TRAILING_SLASH_REGEX = /\/+$/;

export interface CategorizationContextCard {
  _id: Id<"cards">;
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
          }
        : undefined,
    },
  };
};

export const createMissingCardCategorizationResult = () => ({
  mode: "missing" as const,
});

const normalizeUrlForComparison = (
  value: string | undefined
): string | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    const params = url.searchParams;
    // Remove tracking parameters to improve cache hits.
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
    // Normalize trailing slash.
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

  return {
    category: resolution.category,
    confidence: resolution.confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE,
    providerHint: resolution.provider,
    reason: resolution.reason,
  };
};

interface StructuredDataResult {
  entities: any[];
  meta?: {
    etag?: string | null;
    lastModified?: string | null;
    fetchedAt: number;
  };
}

const parseStructuredData = (html: string): StructuredDataResult => {
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
    } catch {
      // Skip invalid JSON-LD blocks
    }
  }

  return { entities };
};

const fetchStructuredData = async (
  url: string
): Promise<StructuredDataResult | null> => {
  try {
    const response = await safeFetch(
      url,
      resolveDns,
      {
        headers: {
          "User-Agent": "TeakBot/1.0 (+https://teak)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      pinnedFetch
    );

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;
    if (contentLength && contentLength > MAX_FETCH_BODY_SIZE * 2) {
      return null;
    }

    const text = new TextDecoder().decode(
      await readBodyWithLimit(response, MAX_FETCH_BODY_SIZE * 2)
    );
    if (!text) {
      return null;
    }

    const truncated =
      text.length > MAX_FETCH_BODY_SIZE
        ? text.slice(0, MAX_FETCH_BODY_SIZE)
        : text;

    const parsed = parseStructuredData(truncated);
    parsed.meta = {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      fetchedAt: Date.now(),
    };
    return parsed;
  } catch {
    return null;
  }
};

export const enrichLinkCategory = async (
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  options?: {
    structuredData?: StructuredDataResult | null;
  }
): Promise<LinkCategoryMetadata> => {
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

  const hasStructuredData = raw && "structured" in raw;
  const providedStructured = options?.structuredData;
  const shouldFetchStructured =
    providedStructured === undefined && !!sourceUrl && !hasStructuredData;

  const structured = shouldFetchStructured
    ? await fetchStructuredData(sourceUrl)
    : (providedStructured ?? null);

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
        structuredMeta: structured?.meta,
      };
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

export const classifyStep: any = internalAction({
  args: {
    cardId: v.id("cards"),
    workflowId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ mode: v.literal("missing") }),
    v.object({
      mode: v.union(v.literal("classified"), v.literal("skipped")),
      card: v.any(),
      sourceUrl: v.string(),
      classification: v.optional(v.any()),
      existingMetadata: v.optional(v.any()),
      shouldFetchStructured: v.boolean(),
    })
  ),
  handler: (ctx: any, args: { cardId: Id<"cards"> }) =>
    withBackendSpan(
      {
        cardId: args.cardId,
        name: "card.categorization.classify",
        operation: TELEMETRY_OPERATIONS.workflowStep,
        stage: "categorization",
        surface: "backend",
      },
      () => classifyHandler(ctx, args)
    ),
});

export async function classifyHandler(
  ctx: any,
  { cardId, workflowId }: { cardId: Id<"cards">; workflowId?: string }
) {
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId,
  });

  if (!card) {
    return createMissingCardCategorizationResult();
  }

  if (card.type !== "link") {
    throw new Error(`Card ${cardId} is not a link card (type: ${card.type})`);
  }

  const contextCard = projectCategorizationSnapshot(
    card as CategorizationContextCard
  );
  const linkPreview =
    contextCard.metadata?.linkPreview?.status === "success"
      ? contextCard.metadata.linkPreview
      : undefined;

  const rawSourceUrl =
    contextCard.url || linkPreview?.finalUrl || linkPreview?.url || "";
  const sourceUrl = normalizeUrlForComparison(rawSourceUrl) || rawSourceUrl;

  const existingMetadata = contextCard.metadata?.linkCategory ?? undefined;

  const METADATA_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
  const metadataFresh =
    existingMetadata?.fetchedAt &&
    Date.now() - existingMetadata.fetchedAt < METADATA_TTL_MS;

  const cachedSourceUrl =
    normalizeUrlForComparison(existingMetadata?.sourceUrl) ||
    existingMetadata?.sourceUrl;

  if (
    existingMetadata?.category &&
    sourceUrl &&
    cachedSourceUrl &&
    sourceUrl === cachedSourceUrl &&
    metadataFresh
  ) {
    return {
      mode: "skipped" as const,
      card: await archiveWorkflowValue(ctx, card, workflowId, contextCard),
      sourceUrl,
      classification: undefined,
      existingMetadata: workflowId ? undefined : existingMetadata,
      shouldFetchStructured: false,
    };
  }

  const classification = await classifyLinkCategory(contextCard, sourceUrl);
  if (!classification) {
    throw new Error(`Failed to classify link category for card ${cardId}`);
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

  return {
    mode: "classified" as const,
    card: await archiveWorkflowValue(ctx, card, workflowId, contextCard),
    sourceUrl,
    classification,
    existingMetadata: workflowId ? undefined : existingMetadata,
    shouldFetchStructured,
  };
}

export const fetchStructuredDataStep: any = internalAction({
  args: {
    cardId: v.id("cards"),
    sourceUrl: v.string(),
    shouldFetch: v.boolean(),
    workflowId: v.optional(v.string()),
  },
  returns: v.object({
    structuredData: v.optional(v.any()),
  }),
  handler: (ctx: any, args: any) =>
    withBackendSpan(
      {
        cardId: args.cardId,
        name: "card.categorization.fetch",
        operation: TELEMETRY_OPERATIONS.workflowStep,
        stage: "categorization",
        surface: "backend",
      },
      () => fetchStructuredDataHandler(ctx, args)
    ),
});

export async function fetchStructuredDataHandler(
  ctx: any,
  {
    cardId,
    sourceUrl,
    shouldFetch,
    workflowId,
  }: {
    cardId: Id<"cards">;
    sourceUrl: string;
    shouldFetch: boolean;
    workflowId?: string;
  }
) {
  if (!(shouldFetch && sourceUrl)) {
    return { structuredData: null };
  }

  const structuredData = await fetchStructuredData(sourceUrl);
  const card = workflowId
    ? await ctx.runQuery(internal.ai.queries.getCardForAI, { cardId })
    : null;
  return {
    structuredData: card
      ? await archiveWorkflowValue(ctx, card, workflowId, structuredData)
      : structuredData,
  };
}

export const mergeAndSaveStep: any = internalAction({
  args: {
    cardId: v.id("cards"),
    card: v.any(),
    sourceUrl: v.string(),
    mode: v.union(v.literal("classified"), v.literal("skipped")),
    classification: v.optional(v.any()),
    existingMetadata: v.optional(v.any()),
    structuredData: v.optional(v.any()),
    workflowId: v.optional(v.string()),
  },
  returns: v.object({
    category: v.string(),
    confidence: v.number(),
    imageUrl: v.optional(v.string()),
    factsCount: v.number(),
  }),
  handler: (ctx: any, args: any) =>
    withBackendSpan(
      {
        cardId: args.cardId,
        name: "card.categorization.persist",
        operation: TELEMETRY_OPERATIONS.workflowStep,
        stage: "persistence",
        surface: "backend",
      },
      () => mergeAndSaveHandler(ctx, args)
    ),
});

export async function mergeAndSaveHandler(
  ctx: any,
  {
    cardId,
    card: cardResult,
    sourceUrl: _sourceUrl,
    mode,
    classification,
    existingMetadata: metadataResult,
    structuredData: structuredResult,
    workflowId,
  }: any
) {
  const card = await hydrateWorkflowValue(ctx, cardId, workflowId, cardResult);
  const existingMetadata = metadataResult ?? card?.metadata?.linkCategory;
  const structuredData = await hydrateWorkflowValue(
    ctx,
    cardId,
    workflowId,
    structuredResult
  );
  if (mode === "skipped") {
    if (!existingMetadata) {
      throw new Error(
        `Existing metadata required to skip classification for card ${cardId}`
      );
    }

    await ctx.runMutation(
      (internal as any)["workflows/steps/categorization/mutations"]
        .updateCategorization,
      {
        cardId,
        metadata: existingMetadata,
      }
    );

    return {
      category: existingMetadata.category,
      confidence:
        existingMetadata.confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE,
      imageUrl: existingMetadata.imageUrl,
      factsCount: existingMetadata.facts?.length ?? 0,
    };
  }

  if (!classification) {
    throw new Error(`Classification result missing for card ${cardId}`);
  }

  const metadata = await enrichLinkCategory(
    await hydrateArchivedMetadata(card as CategorizationContextCard),
    classification as CategoryClassificationResult,
    {
      structuredData,
    }
  );

  await ctx.runMutation(
    (internal as any)["workflows/steps/categorization/mutations"]
      .updateCategorization,
    {
      cardId,
      metadata,
    }
  );

  return {
    category: metadata.category,
    confidence: metadata.confidence ?? LINK_CATEGORY_DEFAULT_CONFIDENCE,
    imageUrl: metadata.imageUrl,
    factsCount: metadata.facts?.length ?? 0,
  };
}
