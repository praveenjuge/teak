// Generated Convex clients and shared helpers
export { api, internal } from "./convex/_generated/api";
export type { Doc, Id } from "./convex/_generated/dataModel";
export * from "./shared";

// Cards domain surface
export * from "./convex/tasks/cards/cardLimit";
export * from "./convex/tasks/cards/createCard";
export * from "./convex/tasks/cards/deleteCard";
export * from "./convex/tasks/cards/generateUploadUrl";
export * from "./convex/tasks/cards/getCard";
export * from "./convex/tasks/cards/getCardCount";
export * from "./convex/tasks/cards/getCards";
export * from "./convex/tasks/cards/getFileUrl";
export * from "./convex/tasks/cards/migrations";
export * from "./convex/tasks/cards/updateCard";
export * from "./convex/tasks/cards/uploadCard";
export * from "./convex/tasks/cards/validationUtils";

// AI task helpers
export * from "./convex/tasks/ai/actions";
export * from "./convex/tasks/ai/mutations";
export * from "./convex/tasks/ai/queries";
export * from "./convex/tasks/ai/schemas";

// Workflow orchestration
export { workflow } from "./convex/workflows/manager";
export { cardProcessingWorkflow } from "./convex/workflows/cardProcessing";
export {
  aiBackfillWorkflow,
  startAiBackfillWorkflow,
} from "./convex/workflows/aiBackfill";
export {
  cardCleanupWorkflow,
  startCardCleanupWorkflow,
} from "./convex/workflows/cardCleanup";
export {
  linkMetadataWorkflow,
  startLinkMetadataWorkflow,
} from "./convex/workflows/linkMetadata";
export {
  linkEnrichmentWorkflow,
  startLinkEnrichmentWorkflow,
} from "./convex/workflows/linkEnrichment";
export {
  screenshotWorkflow,
  startScreenshotWorkflow,
} from "./convex/workflows/screenshot";
export {
  aiMetadataWorkflow,
  startAiMetadataWorkflow,
} from "./convex/workflows/aiMetadata";

export * as classificationStep from "./convex/workflows/steps/classification";
export * as categorizationStep from "./convex/workflows/steps/categorization";
export * as metadataStep from "./convex/workflows/steps/metadata";
export * as renderablesStep from "./convex/workflows/steps/renderables";
