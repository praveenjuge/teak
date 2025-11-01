/**
 * Workflow Manager
 *
 * Central workflow manager instance for the card processing pipeline.
 * Configured with retry behavior for resilient AI processing.
 */

import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "../_generated/api";

/**
 * Workflow manager for card processing pipeline
 *
 * Handles workflow orchestration with automatic retries.
 * Retries are built into the workflow system and will automatically
 * retry failed steps with exponential backoff.
 *
 * Workflow steps:
 * - Classification step: AI card type detection
 * - Categorization step: Link category classification and enrichment
 * - Metadata step: AI tags and summary generation
 * - Renderables step: Thumbnail generation
 */
export const workflow = new WorkflowManager(components.workflow);
