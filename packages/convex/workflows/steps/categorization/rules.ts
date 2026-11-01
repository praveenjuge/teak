import {
  DECISION_TEXT_LIMITS,
  type FilesLinkCategoryDecisionResult,
  readLinkCategoryDecision,
} from "@teak/files-protocol";
import {
  isLinkCategory,
  type LinkCategory,
  type LinkCategoryDetail,
  type LinkCategoryMetadata,
  type LinkPrice,
  parseStructuredPrice,
  resolveLinkCategory,
} from "../../../shared";
import {
  buildRawSelectorMap,
  detectProvider,
  enrichWithStructuredData,
  isJsonLdEntity,
  type JsonLdEntity,
  mergeFacts,
  pickFields,
} from "./enrichment";
import {
  getRawAttribute,
  type ProviderEnrichmentResult,
} from "./providers/common";
import { enrichProvider, providerSupportsCategory } from "./providers/index";
import {
  fillFacts,
  type RemoteDetails,
  type RemoteLookupInput,
} from "./remote/index";

const PREVIEW_HINT_CONFIDENCE = 0.95;
const PAGE_AUDIO_CONFIDENCE = 0.8;
const PAGE_AUDIO_SELECTORS = [
  "meta[property='og:audio']",
  "meta[property='og:audio:secure_url']",
];

const hasPageAudio = (
  raw: Parameters<typeof buildRawSelectorMap>[0] | undefined
): boolean => {
  const map = buildRawSelectorMap(raw);
  return PAGE_AUDIO_SELECTORS.some((selector) =>
    Boolean(getRawAttribute(map, selector, "content")?.trim())
  );
};
const STRUCTURED_DATA_MAX_ITEMS = 8;

const TRAILING_SLASH_REGEX = /\/+$/;

export interface CategorizationLinkPreview {
  categoryHint?: unknown;
  description?: string;
  finalUrl?: string;
  imageUrl?: string;
  raw?: unknown;
  rawSha256?: string;
  rawStorageKey?: string;
  siteName?: string;
  status?: string;
  title?: string;
  url?: string;
}

export interface CategorizationContextCard {
  _id: string;
  content?: string;
  metadata?: {
    linkCategory?: LinkCategoryMetadata;
    linkPreview?: CategorizationLinkPreview;
  };
  metadataStatus?: string;
  notes?: string;
  processingStatus?: unknown;
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

  const hint = linkPreview?.categoryHint;
  if (typeof hint === "string" && isLinkCategory(hint)) {
    return {
      category: hint,
      confidence: PREVIEW_HINT_CONFIDENCE,
      providerHint: resolution.provider,
      reason: "preview_hint",
    };
  }

  // A page that carries its own audio, where only the path or a guess put
  // it elsewhere, is a podcast episode: hosts serve them at /episodes/<slug>,
  // which reads as TV. Sites known by domain, and songs, keep their category.
  if (
    resolution.reason !== "domain_rule" &&
    resolution.category !== "music" &&
    hasPageAudio(linkPreview?.raw)
  ) {
    return {
      category: "podcast",
      confidence: PAGE_AUDIO_CONFIDENCE,
      providerHint: resolution.provider,
      reason: "page_audio",
    };
  }

  return {
    category: resolution.category,
    confidence: resolution.confidence,
    providerHint: resolution.provider,
    reason: resolution.reason,
  };
};

export interface StructuredDataResult {
  entities: JsonLdEntity[];
  meta?: {
    etag?: string | null;
    lastModified?: string | null;
    fetchedAt: number;
  };
}

const parseJsonLdBlock = (jsonText: string): unknown[] => {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
};

export const parseStructuredData = (html: string): StructuredDataResult => {
  const entities: JsonLdEntity[] = [];
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
    for (const item of parseJsonLdBlock(jsonText)) {
      if (isJsonLdEntity(item)) {
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
  }

  return { entities };
};

const enrichmentSourceUrl = (card: CategorizationContextCard): string => {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  return card.url || linkPreview?.finalUrl || linkPreview?.url || "";
};

const linkCategoryStoredFor = (
  card: CategorizationContextCard,
  sourceUrl: string
) => {
  const linkCategory = card.metadata?.linkCategory;
  return linkCategory?.sourceUrl === sourceUrl ? linkCategory : undefined;
};

export const remoteLookupInput = (
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  structuredData: StructuredDataResult | null
): RemoteLookupInput => {
  const sourceUrl = enrichmentSourceUrl(card);
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const stored = linkCategoryStoredFor(card, sourceUrl)?.raw?.structured;
  return {
    category: classification.category,
    entities: structuredData?.entities ?? (stored ? [stored] : []),
    provider: detectProvider(sourceUrl, classification.providerHint),
    rawMap: buildRawSelectorMap(linkPreview?.raw),
    sourceUrl,
  };
};

type StoredRemoteDetails = RemoteDetails & { sourceUrl: string };

type StructuredSource =
  | {
      kind: "read_this_run";
      enriched: ProviderEnrichmentResult;
      meta: StructuredDataResult["meta"];
    }
  | { kind: "reread_without_self"; meta: StructuredDataResult["meta"] }
  | { kind: "stored_from_earlier_pass"; structured: JsonLdEntity }
  | { kind: "none" };

const structuredSourceFor = (
  category: LinkCategory,
  structured: StructuredDataResult | null,
  raw: Record<string, unknown> | undefined
): StructuredSource => {
  const enriched = structured?.entities?.length
    ? enrichWithStructuredData(category, structured.entities)
    : null;
  if (enriched) {
    return { kind: "read_this_run", enriched, meta: structured?.meta };
  }
  if (structured) {
    return { kind: "reread_without_self", meta: structured.meta };
  }
  if (isJsonLdEntity(raw?.structured)) {
    return { kind: "stored_from_earlier_pass", structured: raw.structured };
  }
  return { kind: "none" };
};

const storedRemoteDetails = (
  raw: Record<string, unknown> | undefined,
  sourceUrl: string
): RemoteDetails | null => {
  const stored = raw?.remote as StoredRemoteDetails | undefined;
  if (!stored || typeof stored !== "object" || stored.sourceUrl !== sourceUrl) {
    return null;
  }
  const { sourceUrl: _sourceUrl, ...details } = stored;
  return details;
};

export const enrichLinkCategory = (
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  options: {
    remote?: RemoteDetails | null;
    structuredData?: StructuredDataResult | null;
  } = {}
): LinkCategoryMetadata => {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const sourceUrl = enrichmentSourceUrl(card);
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
    classification.confidence < 0.6
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

  let structuredPrice: LinkPrice | undefined;
  const structured = structuredSourceFor(
    classification.category,
    options.structuredData ?? null,
    raw
  );
  if (structured.kind === "read_this_run") {
    const { enriched } = structured;
    if (enriched.imageUrl && !imageUrl) {
      imageUrl = enriched.imageUrl;
    }
    mergeFacts(facts, enriched.facts);
    structuredPrice = enriched.price;
    raw = {
      ...(raw ?? {}),
      structured: enriched.raw,
      structuredMeta: structured.meta,
    };
  } else if (structured.kind === "reread_without_self") {
    if (raw && "structured" in raw) {
      const { structured: _noLongerOnPage, ...rest } = raw;
      raw = { ...rest, structuredMeta: structured.meta };
    }
  } else if (structured.kind === "stored_from_earlier_pass") {
    const stored = enrichWithStructuredData(classification.category, [
      structured.structured,
    ]);
    if (stored?.imageUrl && !imageUrl) {
      imageUrl = stored.imageUrl;
    }
    mergeFacts(facts, stored?.facts);
    structuredPrice =
      stored?.price ??
      (classification.category === "product"
        ? (parseStructuredPrice(structured.structured) ?? undefined)
        : undefined);
  }

  const remote = options.remote ?? storedRemoteDetails(raw, sourceUrl);
  if (remote) {
    fillFacts(facts, remote.facts);
    if (remote.imageUrl && !imageUrl) {
      imageUrl = remote.imageUrl;
    }
    raw = { ...(raw ?? {}), remote: { ...remote, sourceUrl } };
  } else if (raw && "remote" in raw) {
    const { remote: _storedForOtherUrl, ...rest } = raw;
    raw = rest;
  }

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
  if (remote?.pdfUrl) {
    metadata.pdfUrl = remote.pdfUrl;
  }

  return metadata;
};

export const CLEF_REVIEWED_REASONS = new Set([
  "provider_mapping",
  "heuristic",
  "fallback",
]);

const collectJsonLdTypes = (value: unknown, types: Set<string>, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 3) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdTypes(item, types, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const type of [record["@type"]].flat()) {
    if (typeof type === "string" && type.trim()) {
      types.add(type.trim().slice(0, 80));
    }
  }
  if (record["@graph"]) {
    collectJsonLdTypes(record["@graph"], types, depth + 1);
  }
};

export const jsonLdTypesFrom = (...sources: unknown[]): string[] => {
  const types = new Set<string>();
  for (const source of sources) {
    collectJsonLdTypes(source, types);
  }
  return [...types].slice(0, DECISION_TEXT_LIMITS.linkJsonLdTypes);
};

export const linkCategoryDecisionParams = (
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  sourceUrl: string,
  structuredEntities: unknown
): Record<string, unknown> | null => {
  if (
    !(
      classification.reason &&
      CLEF_REVIEWED_REASONS.has(classification.reason) &&
      sourceUrl
    )
  ) {
    return null;
  }
  const preview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  return {
    url: sourceUrl.slice(0, DECISION_TEXT_LIMITS.linkUrl),
    rulesCategory: classification.category,
    ...(preview?.title ? { title: preview.title } : {}),
    ...(preview?.description ? { description: preview.description } : {}),
    ...(preview?.siteName ? { siteName: preview.siteName } : {}),
    jsonLdTypes: jsonLdTypesFrom(
      structuredEntities,
      card.metadata?.linkCategory?.raw?.structured
    ),
  };
};

export const readLinkCategoryReply = (
  data: unknown
): FilesLinkCategoryDecisionResult | null =>
  readLinkCategoryDecision(data, isLinkCategory);

export const applyLinkCategoryDecision = (
  classification: CategoryClassificationResult,
  result: FilesLinkCategoryDecisionResult | null
): CategoryClassificationResult => {
  const decision = result?.decision;
  if (!(decision && isLinkCategory(decision.category))) {
    return classification;
  }
  if (
    classification.reason === "provider_mapping" &&
    !providerSupportsCategory(classification.providerHint, decision.category)
  ) {
    return classification;
  }
  return {
    ...classification,
    category: decision.category,
    confidence: decision.confidence,
    reason: "clef",
  };
};
