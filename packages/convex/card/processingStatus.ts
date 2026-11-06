import {
  cardTypeStages,
  type ProcessingStageKey,
  type ProcessingStageStatus,
  type ProcessingStatus,
} from "@teak/files-protocol";

export type {
  ProcessingStageKey,
  ProcessingStageStatus,
  ProcessingStatus,
} from "@teak/files-protocol";

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

export const mergeProcessingStages = (
  current: ProcessingStatus | undefined,
  stages: Partial<ProcessingStatus>
): ProcessingStatus => ({ ...(current ?? {}), ...stages });

/**
 * The stages a classified card of this type starts with: metadata always,
 * categorize and renderables when the type runs them, and for a link the
 * archive and article (unless `archive` says what they are instead).
 */
export const buildInitialProcessingStatus = ({
  archive,
  cardType,
  classificationStatus,
  now,
}: {
  archive?: Pick<ProcessingStatus, "archive" | "article">;
  cardType: string;
  classificationStatus?: ProcessingStageStatus;
  now: number;
}): ProcessingStatus => {
  const stages = cardTypeStages(cardType);
  const runIf = (runs: boolean) =>
    runs ? stagePending() : stageCompleted(now);
  return {
    ...(classificationStatus ? { classify: classificationStatus } : {}),
    categorize: runIf(stages.categorize),
    metadata: stagePending(),
    renderables: runIf(stages.renderables),
    ...(archive ??
      (stages.archive
        ? { archive: stagePending(), article: stagePending() }
        : {})),
  };
};
