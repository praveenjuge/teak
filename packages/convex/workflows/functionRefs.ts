/**
 * Function References for Workflow
 *
 * Helper to properly type workflow function references
 */

import { internal } from "../_generated/api";

// Create properly typed references for workflow functions
type WorkflowFunctionMap = Record<string, unknown>;
const internalFunctions = internal as Record<string, unknown>;
const linkMetadataFunctions = internalFunctions[
  "workflows/linkMetadata"
] as Record<string, unknown>;
const linkEnrichmentFunctions = internalFunctions[
  "workflows/linkEnrichment"
] as Record<string, unknown>;

export const workflowFunctions: WorkflowFunctionMap = {
  classify: internalFunctions["workflows/steps/classification"],
  categorizationSteps:
    internalFunctions["workflows/steps/categorization/index"],
  generateMetadata: internalFunctions["workflows/steps/metadata"],
  generateRenderables: internalFunctions["workflows/steps/renderables"],
  updateClassification:
    internalFunctions["workflows/steps/classificationMutations"],
  updateCategorization:
    internalFunctions["workflows/steps/categorization/mutations"],
  cardProcessingWorkflow: internalFunctions["workflows/cardProcessing"],
  fetchLinkMetadata:
    internalFunctions["workflows/steps/linkMetadata/fetchMetadata"],
  linkMetadataWorkflow: linkMetadataFunctions.linkMetadataWorkflow,
  startLinkMetadataWorkflow: linkMetadataFunctions.startLinkMetadataWorkflow,
  linkEnrichmentWorkflow: linkEnrichmentFunctions.linkEnrichmentWorkflow,
  startLinkEnrichmentWorkflow:
    linkEnrichmentFunctions.startLinkEnrichmentWorkflow,
};
