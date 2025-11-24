// Generated Convex clients and shared helpers
export { api, internal } from "./_generated/api";
export type { Doc, Id } from "./_generated/dataModel";
export * from "./shared";

// Cards domain surface
export * from "./tasks/cards/cardLimit";
export * from "./tasks/cards/createCard";
export * from "./tasks/cards/deleteCard";
export * from "./tasks/cards/generateUploadUrl";
export * from "./tasks/cards/getCard";
export * from "./tasks/cards/getCards";
export * from "./tasks/cards/getFileUrl";
export * from "./tasks/cards/migrations";
export * from "./tasks/cards/updateCard";
export * from "./tasks/cards/uploadCard";
export * from "./tasks/cards/validationUtils";

// AI task helpers
export * from "./tasks/ai/actions";
export * from "./tasks/ai/mutations";
export * from "./tasks/ai/queries";
export * from "./tasks/ai/schemas";

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
