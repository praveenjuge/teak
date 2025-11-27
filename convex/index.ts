// Generated Convex clients and shared helpers
export { api, internal } from "./_generated/api";
export type { Doc, Id } from "./_generated/dataModel";
export * from "./shared";

// Sentry integration for error tracking and tracing
export * from "./sentry";

// Cards domain surface
export * from "./card/cardLimit";
export * from "./card/createCard";
export * from "./card/deleteCard";
export * from "./card/generateUploadUrl";
export * from "./card/getCard";
export * from "./card/getCards";
export * from "./card/getFileUrl";
export * from "./card/migrations";
export * from "./card/updateCard";
export * from "./card/uploadCard";
export * from "./card/validationUtils";
export * from "./card/processingStatus";
export * from "./card/quoteFormatting";

// AI task helpers
export * from "./ai/actions";
export * from "./ai/mutations";
export * from "./ai/queries";
export * from "./ai/schemas";

// Workflow orchestration
export { workflow } from "./workflows/manager";
export { cardProcessingWorkflow } from "./workflows/cardProcessing";
export {
  aiBackfillWorkflow,
  startAiBackfillWorkflow,
} from "./workflows/aiBackfill";
export {
  cardCleanupWorkflow,
  startCardCleanupWorkflow,
} from "./workflows/cardCleanup";
export {
  linkMetadataWorkflow,
  startLinkMetadataWorkflow,
} from "./workflows/linkMetadata";
export {
  linkEnrichmentWorkflow,
  startLinkEnrichmentWorkflow,
} from "./workflows/linkEnrichment";
export {
  screenshotWorkflow,
  startScreenshotWorkflow,
} from "./workflows/screenshot";
export {
  aiMetadataWorkflow,
  startAiMetadataWorkflow,
} from "./workflows/aiMetadata";

export * as classificationStep from "./workflows/steps/classification";
export * as categorizationStep from "./workflows/steps/categorization";
export * as metadataStep from "./workflows/steps/metadata";
export * as renderablesStep from "./workflows/steps/renderables";
