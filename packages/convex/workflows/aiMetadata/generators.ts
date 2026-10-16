"use node";

import {
  buildLinkMetadataPrompt,
  buildTextMetadataPrompt,
  type FilesTextMetadataOpResult,
  readFilesAiGenerationFacts,
  readVisualStylesDecision,
  validateTextMetadata,
} from "@teak/files-protocol";
import { isVisualStyle, type VisualStyle } from "../../shared/constants";

export {
  boundAiMetadataInput,
  MAX_AI_METADATA_INPUT_CHARS,
  MAX_AI_METADATA_OUTPUT_TOKENS,
  MAX_AI_METADATA_VALIDATION_RETRIES,
} from "@teak/files-protocol";

import { SYSTEM_PROMPTS, TEXT_METADATA_MODEL_ID } from "../../ai/models";
import { observeAiGeneration } from "../../ai/telemetry";
import {
  callFilesWorkerJson,
  type FilesWorkerImageMetadataResult,
  type FilesWorkerOutcome,
} from "../../storage/filesWorkerClient";
import { normalizeAiTags } from "./tags";

const JSON_VALIDATION_ERROR =
  /failed to validate json|failed_generation|no (?:object|output) generated|response did not match schema|type validation failed/iu;
const PROVIDER_CAPACITY_ERROR =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|status(?: code)? 429|429)\b/iu;
const RASTER_THUMBNAIL_PENDING_ERROR = /waiting for a raster thumbnail/iu;

export const isAiProviderCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return PROVIDER_CAPACITY_ERROR.test(message);
};

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

const generateWorkerMetadata = async (
  op: "generate-text-metadata" | "generate-link-metadata",
  prompt: string
) => {
  const model = TEXT_METADATA_MODEL_ID;
  const isLink = op === "generate-link-metadata";
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
      const outcome: FilesWorkerOutcome<FilesTextMetadataOpResult> =
        await callFilesWorkerJson<FilesTextMetadataOpResult>({
          op,
          params: { prompt },
        });
      if (outcome.kind === "fallback") {
        throw new Error("files_worker_metadata_unavailable");
      }
      const facts = readFilesAiGenerationFacts(outcome.data);
      if (!facts) {
        throw new Error("failed to validate JSON metadata diagnostics");
      }
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
  title?: string,
  options: { visualStyles?: boolean } = {}
) => {
  const outcome = await callFilesWorkerJson<FilesWorkerImageMetadataResult>({
    op: "generate-image-metadata",
    params: {
      sourceKey,
      ...(title ? { title } : {}),
      ...(options.visualStyles ? { visualStyles: true } : {}),
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
    visualStyles: await readClefVisualStyles(outcome.data.visualStyles),
  };
};

/**
 * Clef's styles from the image op, when it ran and replied validly; else
 * `undefined`, so the caller falls back to the tag aliases.
 */
const readClefVisualStyles = async (
  value: unknown
): Promise<VisualStyle[] | undefined> => {
  if (value === undefined) {
    return;
  }
  const decision = readVisualStylesDecision(value, isVisualStyle);
  if (!decision) {
    return;
  }
  await observeAiGeneration(
    {
      functionId: "teak.ai.decision.decide-visual-styles",
      model: decision.model,
      stage: "ai_metadata",
    },
    () => Promise.resolve({ usage: decision.usage })
  );
  return decision.styles as VisualStyle[];
};

export const generateLinkMetadata = (content: string, url?: string) =>
  generateWorkerMetadata(
    "generate-link-metadata",
    buildLinkMetadataPrompt(content, url)
  );
