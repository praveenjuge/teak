import type { CardType } from "../../schema";

export type ProcessingStageStatus = {
  status: "pending" | "in_progress" | "completed" | "failed";
  startedAt?: number;
  completedAt?: number;
  confidence?: number;
  error?: string;
};

export type ProcessingStatus = {
  classify?: ProcessingStageStatus;
  categorize?: ProcessingStageStatus;
  metadata?: ProcessingStageStatus;
  renderables?: ProcessingStageStatus;
};

export type ProcessingStageKey = keyof ProcessingStatus;

export const stageCompleted = (
  now: number,
  confidence = 1
): ProcessingStageStatus => ({
  status: "completed",
  completedAt: now,
  confidence,
});

export const stagePending = (): ProcessingStageStatus => ({
  status: "pending",
});

export const stageInProgress = (
  now: number,
  previous?: ProcessingStageStatus
): ProcessingStageStatus => ({
  status: "in_progress",
  startedAt: previous?.startedAt ?? now,
  confidence: previous?.confidence,
});

export const stageFailed = (
  now: number,
  error: string,
  previous?: ProcessingStageStatus
): ProcessingStageStatus => ({
  status: "failed",
  startedAt: previous?.startedAt ?? now,
  completedAt: now,
  confidence: previous?.confidence,
  error,
});

export const withStageStatus = (
  current: ProcessingStatus | undefined,
  stage: ProcessingStageKey,
  status: ProcessingStageStatus
): ProcessingStatus => ({
  ...(current ?? {}),
  [stage]: status,
});

export const shouldRunRenderablesStage = (cardType: CardType): boolean => {
  return cardType === "image" || cardType === "video" || cardType === "document";
};

export const shouldRunCategorizeStage = (cardType: CardType): boolean => {
  return cardType === "link";
};

export const buildInitialProcessingStatus = (
  params: {
    now: number;
    cardType: CardType;
    classificationStatus?: ProcessingStageStatus;
    metadataStageNeeded?: boolean;
    renderablesStageOverride?: boolean;
    categorizeStageOverride?: boolean;
  }
): ProcessingStatus => {
  const { now: timestamp, cardType, classificationStatus, metadataStageNeeded = true } = params;
  const result: ProcessingStatus = {};

  if (classificationStatus) {
    result.classify = classificationStatus;
  }

  const shouldCategorize =
    params.categorizeStageOverride ?? shouldRunCategorizeStage(cardType);

  result.categorize = shouldCategorize ? stagePending() : stageCompleted(timestamp, 1);

  result.metadata = metadataStageNeeded ? stagePending() : stageCompleted(timestamp, 1);

  const shouldRunRenderables =
    params.renderablesStageOverride ?? shouldRunRenderablesStage(cardType);

  result.renderables = shouldRunRenderables ? stagePending() : stageCompleted(timestamp, 1);

  return result;
};
