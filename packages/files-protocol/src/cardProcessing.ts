/**
 * The card-processing contract Convex and the Core Worker share: the stages
 * a card's `processingStatus` tracks, which ones a card type runs, and the
 * params a card-processing run starts with.
 */

/**
 * Every stage, in run order. `archive` (the link's saved copy) and
 * `article` (the article taken from it) never fail the card: a run with
 * nothing to archive leaves them as they were.
 */
export const CARD_PROCESSING_STAGES = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
  "screenshot",
  "archive",
  "article",
] as const;
export type ProcessingStageKey = (typeof CARD_PROCESSING_STAGES)[number];

/** The stages a whole run owns; a run that dies fails the unfinished ones. */
export const CARD_RUN_STAGES = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
  "screenshot",
] as const satisfies readonly ProcessingStageKey[];

/** The AI pipeline stages the admin overview counts. */
export const AI_PIPELINE_STAGES = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
] as const satisfies readonly ProcessingStageKey[];

export const PROCESSING_STAGE_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
] as const;
export type ProcessingStageState = (typeof PROCESSING_STAGE_STATUSES)[number];

export interface ProcessingStageStatus {
  completedAt?: number;
  confidence?: number;
  error?: string;
  startedAt?: number;
  status: ProcessingStageState;
}

export type ProcessingStatus = Partial<
  Record<ProcessingStageKey, ProcessingStageStatus>
>;

const RENDERABLE_CARD_TYPES: readonly string[] = ["image", "video", "document"];

/** The optional stages a card of this type runs. */
export const cardTypeStages = (
  cardType: string
): { archive: boolean; categorize: boolean; renderables: boolean } => ({
  archive: cardType === "link",
  categorize: cardType === "link",
  renderables: RENDERABLE_CARD_TYPES.includes(cardType),
});

/** What a card-processing run is asked to do. */
export interface CardProcessingParams {
  /**
   * Only "load card", "archive page" and the article steps run: a link's
   * saved copy and the article in it.
   */
  archiveOnly?: true;
  /** Only "load card" and the article steps run: a link's article. */
  articleOnly?: true;
  cardId: string;
  metadataOnly?: true;
  /** Refresh details: fetch and archive the page again. */
  refresh?: true;
  /** The card's processing revision the run writes under. */
  rev: number;
}

/**
 * The message a workflow reports when Cloudflare has no instance for its
 * id, so Convex starts it again.
 */
export const WORKFLOW_INSTANCE_MISSING = "instance_missing";
