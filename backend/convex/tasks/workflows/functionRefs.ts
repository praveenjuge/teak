/**
 * Function References for Workflow
 *
 * Helper to properly type workflow function references
 */

import { internal } from "../../_generated/api";

// Create properly typed references for workflow functions
type WorkflowFunctionMap = Record<string, unknown>;

export const workflowFunctions: WorkflowFunctionMap = {
  classify: internal["tasks/workflows/steps/classification" as keyof typeof internal] as any,
  categorize: internal["tasks/workflows/steps/categorization/index" as keyof typeof internal] as any,
  generateMetadata: internal["tasks/workflows/steps/metadata" as keyof typeof internal] as any,
  generateRenderables: internal["tasks/workflows/steps/renderables" as keyof typeof internal] as any,
  updateClassification: internal["tasks/workflows/steps/classificationMutations" as keyof typeof internal] as any,
  updateCategorization: internal["tasks/workflows/steps/categorization/mutations" as keyof typeof internal] as any,
  cardProcessingWorkflow: internal["tasks/workflows/cardProcessing" as keyof typeof internal] as any,
};
