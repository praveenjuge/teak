"use node";

import {
  buildLinkMetadataPrompt,
  buildTextMetadataPrompt,
  type FilesTextMetadataOpResult,
  MAX_AI_METADATA_VALIDATION_RETRIES,
  readFilesAiGenerationFacts,
  validateTextMetadata,
} from "@teak/files-protocol";

export {
  boundAiMetadataInput,
  MAX_AI_METADATA_INPUT_CHARS,
  MAX_AI_METADATA_OUTPUT_TOKENS,
  MAX_AI_METADATA_VALIDATION_RETRIES,
} from "@teak/files-protocol";

import { SYSTEM_PROMPTS, TEXT_METADATA_MODEL_ID } from "../../ai/models";
import { observeAiGeneration, WORKERS_AI_PROVIDER } from "../../ai/telemetry";
import { trackAiRetry } from "../../shared/metrics";
import {
  callFilesWorkerJson,
  type FilesWorkerImageMetadataResult,
  type FilesWorkerOutcome,
} from "../../storage/filesWorkerClient";
import { normalizeAiTags } from "./tags";

/**
 * All metadata generation runs in the Files Worker on its Workers AI binding
 * (text, link, and image ops). Convex sends prompts or storage keys, never
 * bytes, and keeps telemetry and the workflow's deferral semantics.
 */
const JSON_VALIDATION_ERROR =
  /failed to validate json|failed_generation|no (?:object|output) generated|response did not match schema|type validation failed/iu;
const PROVIDER_CAPACITY_ERROR =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|status(?: code)? 429|429)\b/iu;
const RASTER_THUMBNAIL_PENDING_ERROR = /waiting for a raster thumbnail/iu;

export const isAiProviderCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return PROVIDER_CAPACITY_ERROR.test(message);
};

// Without FILES_BASE and its signing secret (the local E2E stack, or a
// deployment missing its Files Worker configuration) every metadata op fails
// before any request is made, and no retry can change that.
export const FILES_WORKER_NOT_CONFIGURED = "files_worker_not_configured";

export const isAiMetadataDeferredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === FILES_WORKER_NOT_CONFIGURED ||
    PROVIDER_CAPACITY_ERROR.test(message) ||
    JSON_VALIDATION_ERROR.test(message) ||
    RASTER_THUMBNAIL_PENDING_ERROR.test(message) ||
    message === "files_worker_metadata_unavailable"
  );
};

/**
 * Generate AI metadata for text content
 */
const generateWorkerMetadata = async (
  op: "generate-text-metadata" | "generate-link-metadata",
  prompt: string
) => {
  const model = TEXT_METADATA_MODEL_ID;
  const isLink = op === "generate-link-metadata";
  const recordRetries = (count: number) => {
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_AI_METADATA_VALIDATION_RETRIES
    ) {
      return;
    }
    for (let attempt = 0; attempt < count; attempt += 1) {
      trackAiRetry({
        model,
        provider: WORKERS_AI_PROVIDER,
        reason: "validation",
      });
    }
  };
  const result = await observeAiGeneration(
    {
      functionId: isLink ? "teak.ai.metadata.link" : "teak.ai.metadata.text",
      model,
      prompt,
      system: isLink
        ? SYSTEM_PROMPTS.linkAnalysis
        : SYSTEM_PROMPTS.textAnalysis,
      stage: "ai_metadata",
    },
    async () => {
      let outcome: FilesWorkerOutcome<FilesTextMetadataOpResult>;
      try {
        outcome = await callFilesWorkerJson<FilesTextMetadataOpResult>({
          op,
          params: { prompt },
        });
      } catch (error) {
        if (error && typeof error === "object" && "aiFacts" in error) {
          recordRetries(
            (error as { aiFacts?: { validationRetryCount?: number } }).aiFacts
              ?.validationRetryCount ?? 0
          );
        }
        throw error;
      }
      if (outcome.kind === "fallback") {
        throw new Error("files_worker_metadata_unavailable");
      }
      const facts = readFilesAiGenerationFacts(outcome.data);
      if (!facts) {
        throw new Error("failed to validate JSON metadata diagnostics");
      }
      recordRetries(facts.validationRetryCount);
      const metadata = validateTextMetadata(outcome.data);
      if (!metadata) {
        throw new Error("failed to validate JSON metadata response");
      }
      return { output: metadata, usage: facts.usage };
    }
  );
  return {
    aiTags: normalizeAiTags(result.output.tags),
    aiSummary: result.output.summary,
  };
};
export const generateTextMetadata = (content: string, title?: string) =>
  generateWorkerMetadata(
    "generate-text-metadata",
    buildTextMetadataPrompt(content, title)
  );

/**
 * Generate AI metadata for a stored image via the Files Worker's
 * `generate-image-metadata` op. The worker feeds its existing `detail`
 * rendition into Workers AI with the same model, prompt, output schema, and
 * bounded validation retries — image bytes never reach Convex.
 *
 * A worker fallback (missing/oversized/unsupported source) surfaces as the
 * same deferred "raster thumbnail pending" condition.
 */
export const generateImageMetadataForStoredKey = async (
  sourceKey: string,
  title?: string
) => {
  const outcome = await callFilesWorkerJson<FilesWorkerImageMetadataResult>({
    op: "generate-image-metadata",
    params: {
      sourceKey,
      ...(title ? { title } : {}),
    },
  });
  if (outcome.kind === "fallback") {
    throw new Error(
      "Image analysis is waiting for a raster thumbnail (worker unavailable)"
    );
  }
  return {
    aiTags: normalizeAiTags(outcome.data.tags),
    aiSummary: outcome.data.summary,
  };
};

/**
 * Generate AI metadata for link content
 */
export const generateLinkMetadata = (content: string, url?: string) =>
  generateWorkerMetadata(
    "generate-link-metadata",
    buildLinkMetadataPrompt(content, url)
  );
