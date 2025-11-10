export type StageSummary = {
  pending: number;
  inProgress: number;
  failed: number;
};

export type OverviewResponse = {
  generatedAt: number;
  totals: {
    totalCards: number;
    activeCards: number;
    deletedCards: number;
    uniqueUsers: number;
  };
  growth: {
    createdLastSevenDays: number;
    createdLastThirtyDays: number;
  };
  cardsByType: Record<string, number>;
  metadataStatus: Record<string, number>;
  aiPipeline: RawPipelineSummary;
};

export type RawPipelineSummary = {
  missingAiMetadata?: number;
  pendingEnrichment?: number;
  failedCards?: number;
  stageSummaries?: Record<string, StageSummary | undefined>;
  missingCards?: unknown;
};

export type PipelineStageStatus = {
  status?: "pending" | "in_progress" | "completed" | "failed";
};

export type PipelineProcessingStatus = Record<
  string,
  PipelineStageStatus | undefined
>;

export type MissingCard = {
  cardId: string;
  type: string;
  createdAt: number;
  metadataStatus?: "pending" | "completed" | "failed";
  processingStatus?: PipelineProcessingStatus;
  reasons: string[];
};

export type NormalizedPipelineSummary = {
  missingAiMetadata: number;
  pendingEnrichment: number;
  failedCards: number;
  stageSummaries: Record<string, StageSummary>;
  missingCards: MissingCard[];
};

export type HeadlineCard = {
  title: string;
  value: string;
  description: string;
};

export type MetadataItem = {
  label: string;
  value: number;
};

export type StageListEntry = {
  key: string;
  label: string;
  summary: StageSummary;
};

export const stageLabelMap: Record<string, string> = {
  classify: "Classification",
  categorize: "Categorization",
  metadata: "Metadata",
  renderables: "Renderables",
};

export const STAGE_ORDER = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
] as const;

export const MAX_PENDING_COUNT = 50;

export const formatNumber = (value: number) =>
  Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const coerceStageSummary = (summary?: StageSummary): StageSummary => ({
  pending: Number(summary?.pending ?? 0),
  inProgress: Number(summary?.inProgress ?? 0),
  failed: Number(summary?.failed ?? 0),
});

const normalizeMissingCards = (value: unknown): MissingCard[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((card): MissingCard | null => {
      const rawId = (card as Record<string, unknown>).cardId;
      const id =
        typeof rawId === "string"
          ? rawId
          : rawId != null
            ? String(rawId)
            : "";
      if (!id) {
        return null;
      }

      const reasons = Array.isArray(
        (card as Record<string, unknown>).reasons
      )
        ? ((card as Record<string, unknown>).reasons as unknown[])
            .map((reason) =>
              typeof reason === "string" ? reason : String(reason)
            )
            .filter((reason) => reason.trim().length > 0)
        : [];

      return {
        cardId: id,
        type:
          typeof (card as Record<string, unknown>).type === "string"
            ? ((card as Record<string, unknown>).type as string)
            : "unknown",
        createdAt: Number((card as Record<string, unknown>).createdAt ?? 0),
        metadataStatus: (card as Record<string, unknown>)
          .metadataStatus as MissingCard["metadataStatus"],
        processingStatus: (card as Record<string, unknown>)
          .processingStatus as PipelineProcessingStatus,
        reasons: reasons.length > 0 ? reasons : ["Unknown reason"],
      };
    })
    .filter((card): card is MissingCard => card !== null);
};

export const normalizePipelineSummary = (
  summary?: RawPipelineSummary
): NormalizedPipelineSummary => {
  const stageSummaries = Object.entries(summary?.stageSummaries ?? {}).reduce<
    Record<string, StageSummary>
  >((acc, [stage, value]) => {
    acc[stage] = coerceStageSummary(value);
    return acc;
  }, {});

  return {
    missingAiMetadata: Number(summary?.missingAiMetadata ?? 0),
    pendingEnrichment: Number(summary?.pendingEnrichment ?? 0),
    failedCards: Number(summary?.failedCards ?? 0),
    stageSummaries,
    missingCards: normalizeMissingCards(summary?.missingCards),
  };
};

export const formatProcessingSummary = (
  processingStatus?: PipelineProcessingStatus
) => {
  if (!processingStatus) {
    return "Not started";
  }

  const parts = STAGE_ORDER.map((key) => {
    const status = processingStatus[key]?.status;
    if (!status) {
      return null;
    }
    return `${stageLabelMap[key] ?? key}: ${status.replace(/_/g, " ")}`;
  }).filter(Boolean);

  return parts.length > 0 ? parts.join(" • ") : "Queued";
};

export const buildStageList = (
  stageSummaries: Record<string, StageSummary>
): StageListEntry[] => {
  const ordered = STAGE_ORDER.map((key) => ({
    key,
    label: stageLabelMap[key] ?? key,
    summary: coerceStageSummary(stageSummaries[key]),
  }));

  const extras = Object.entries(stageSummaries)
    .filter(
      ([key]) => !STAGE_ORDER.includes(key as (typeof STAGE_ORDER)[number])
    )
    .map(([key, summary]) => ({
      key,
      label: stageLabelMap[key] ?? key,
      summary: coerceStageSummary(summary),
    }));

  return [...ordered, ...extras];
};
