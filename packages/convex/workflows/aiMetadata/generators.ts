"use node";

import {
  boundAiMetadataInput,
  buildLinkMetadataPrompt,
  buildTextMetadataPrompt,
  type FilesTextMetadataOpResult,
  MAX_AI_METADATA_OUTPUT_TOKENS,
  MAX_AI_METADATA_VALIDATION_RETRIES,
  readFilesAiGenerationFacts,
  validateTextMetadata,
  validationRetryPrompt,
} from "@teak/files-protocol";
import { generateText, Output } from "ai";

export {
  boundAiMetadataInput,
  MAX_AI_METADATA_INPUT_CHARS,
  MAX_AI_METADATA_OUTPUT_TOKENS,
  MAX_AI_METADATA_VALIDATION_RETRIES,
} from "@teak/files-protocol";

import { env } from "../../_generated/server";
import {
  IMAGE_METADATA_MODEL,
  IMAGE_METADATA_MODEL_ID,
  LINK_METADATA_MODEL,
  LINK_METADATA_MODEL_ID,
  SYSTEM_PROMPTS,
  TEXT_METADATA_MODEL,
  TEXT_METADATA_MODEL_ID,
} from "../../ai/models";
import {
  createAiTelemetrySettings,
  observeAiGeneration,
  WORKERS_AI_PROVIDER,
} from "../../ai/telemetry";
import { trackAiRetry } from "../../shared/metrics";
import {
  callFilesWorkerJson,
  type FilesWorkerImageMetadataResult,
  type FilesWorkerOutcome,
} from "../../storage/filesWorkerClient";
import { recordBackendLog } from "../../telemetry/sentry";
import { aiMetadataSchema } from "./schemas";

/**
 * Cloudflare Workers AI notes:
 *
 * The provider targets the OpenAI-compatible `/ai/v1` endpoint, which maps
 * `Output.object` requests to server-side `response_format: { type:
 * "json_object" }`. The schema itself is enforced client-side against the Zod
 * schema (unknown keys stripped), so leaked or malformed fields fail softly
 * and are handled by the bounded validation retries below.
 *
 * Reasoning models (qwen3) are switched to non-thinking mode via the
 * "/no_think" suffix baked into the system prompts in ai/models.ts.
 */
export const MAX_AI_METADATA_RETRIES = 0;

const JSON_VALIDATION_ERROR =
  /failed to validate json|failed_generation|no (?:object|output) generated|response did not match schema|type validation failed/iu;
const PROVIDER_CAPACITY_ERROR =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|status(?: code)? 429|429)\b/iu;
const RASTER_THUMBNAIL_PENDING_ERROR = /waiting for a raster thumbnail/iu;
const SUPPORTED_VISION_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const isAiProviderCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return PROVIDER_CAPACITY_ERROR.test(message);
};

export const isAiMetadataDeferredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    PROVIDER_CAPACITY_ERROR.test(message) ||
    JSON_VALIDATION_ERROR.test(message) ||
    RASTER_THUMBNAIL_PENDING_ERROR.test(message)
  );
};

const generateWithValidationRetries = async <T>(
  model: string,
  generate: (attempt: number) => Promise<T>
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await generate(attempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= MAX_AI_METADATA_VALIDATION_RETRIES ||
        !JSON_VALIDATION_ERROR.test(message)
      ) {
        throw error;
      }
      trackAiRetry({
        model,
        provider: WORKERS_AI_PROVIDER,
        reason: "validation",
      });
      recordBackendLog("warn", "ai.generation.validation_retry", {
        attempt: attempt + 1,
        model,
        provider: WORKERS_AI_PROVIDER,
        reason: "validation",
      });
    }
  }
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
  return { aiTags: result.output.tags, aiSummary: result.output.summary };
};
export const generateTextMetadata = (content: string, title?: string) =>
  env.FILES_TEXT_AI_ENABLED === "true"
    ? generateWorkerMetadata(
        "generate-text-metadata",
        buildTextMetadataPrompt(content, title)
      )
    : generateTextMetadataDirect(content, title);

/**
 * Generate AI metadata for image content (using vision)
 *
 * Cloudflare Workers AI only accepts inline base64 image data on its
 * OpenAI-compatible endpoint (no remote URL fetching), so the image is
 * downloaded here and sent as bytes.
 */
export const resolveImageAnalysisInput = async (
  imageUrl: string
): Promise<{ data: Uint8Array; mediaType?: string }> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image: ${response.status} ${response.statusText}`
    );
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (!(contentType && SUPPORTED_VISION_MEDIA_TYPES.has(contentType))) {
    throw new Error(
      `Image analysis is waiting for a raster thumbnail (received ${
        contentType || "unknown media type"
      })`
    );
  }
  const buffer = await response.arrayBuffer();
  return {
    data: new Uint8Array(buffer),
    mediaType: contentType,
  };
};

export const generateImageMetadata = async (
  imageUrl: string,
  title?: string
) => {
  const image = await resolveImageAnalysisInput(imageUrl);
  const prompt = boundAiMetadataInput(
    title
      ? `Image title: ${title}\n\nAnalyze this image and generate tags and summary:`
      : "Analyze this image and generate tags and summary:"
  );
  const result = await observeAiGeneration(
    {
      functionId: "teak.ai.metadata.image",
      model: IMAGE_METADATA_MODEL_ID,
      prompt,
      stage: "ai_metadata",
      system: SYSTEM_PROMPTS.imageAnalysis,
    },
    () =>
      generateWithValidationRetries(IMAGE_METADATA_MODEL_ID, (attempt) =>
        generateText({
          experimental_telemetry: createAiTelemetrySettings({
            functionId: "teak.ai.metadata.image",
            model: IMAGE_METADATA_MODEL_ID,
            stage: "ai_metadata",
          }),
          model: IMAGE_METADATA_MODEL,
          maxRetries: MAX_AI_METADATA_RETRIES,
          maxOutputTokens: MAX_AI_METADATA_OUTPUT_TOKENS,
          // Static system prompt
          system: SYSTEM_PROMPTS.imageAnalysis,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  // Dynamic text content
                  text: validationRetryPrompt(prompt, attempt),
                },
                {
                  type: "image",
                  // Inline bytes — Workers AI rejects remote image URLs
                  image: image.data,
                  ...(image.mediaType ? { mediaType: image.mediaType } : {}),
                },
              ],
            },
          ],
          output: Output.object({
            schema: aiMetadataSchema,
          }),
        })
      )
  );

  return {
    aiTags: result.output.tags,
    aiSummary: result.output.summary,
  };
};

/**
 * Generate AI metadata for a stored image via the Files Worker's
 * `generate-image-metadata` op. The worker feeds its existing `detail`
 * rendition into Workers AI with the same model, prompt, output schema, and
 * bounded validation retries — image bytes never reach Convex.
 *
 * A worker fallback (missing/oversized/unsupported source) surfaces as the
 * same deferred "raster thumbnail pending" condition the direct path used.
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
    aiTags: outcome.data.tags,
    aiSummary: outcome.data.summary,
  };
};

/**
 * Generate AI metadata for link content
 */
export const generateLinkMetadata = (content: string, url?: string) =>
  env.FILES_TEXT_AI_ENABLED === "true"
    ? generateWorkerMetadata(
        "generate-link-metadata",
        buildLinkMetadataPrompt(content, url)
      )
    : generateLinkMetadataDirect(content, url);

const generateTextMetadataDirect = async (content: string, title?: string) => {
  const prompt = buildTextMetadataPrompt(content, title);

  const result = await observeAiGeneration(
    {
      functionId: "teak.ai.metadata.text",
      model: TEXT_METADATA_MODEL_ID,
      prompt,
      stage: "ai_metadata",
      system: SYSTEM_PROMPTS.textAnalysis,
    },
    () =>
      generateWithValidationRetries(TEXT_METADATA_MODEL_ID, (attempt) =>
        generateText({
          experimental_telemetry: createAiTelemetrySettings({
            functionId: "teak.ai.metadata.text",
            model: TEXT_METADATA_MODEL_ID,
            stage: "ai_metadata",
          }),
          model: TEXT_METADATA_MODEL,
          // Metadata is optional. Surface provider errors immediately so the
          // workflow can skip exhausted capacity or apply its own bounded retry
          // without the SDK waiting through provider-supplied reset windows.
          maxRetries: MAX_AI_METADATA_RETRIES,
          maxOutputTokens: MAX_AI_METADATA_OUTPUT_TOKENS,
          // Static system prompt
          system: SYSTEM_PROMPTS.textAnalysis,
          // Dynamic content last
          prompt: validationRetryPrompt(prompt, attempt),
          output: Output.object({
            schema: aiMetadataSchema,
          }),
        })
      )
  );

  return {
    aiTags: result.output.tags,
    aiSummary: result.output.summary,
  };
};

const generateLinkMetadataDirect = async (content: string, url?: string) => {
  const prompt = buildLinkMetadataPrompt(content, url);
  const result = await observeAiGeneration(
    {
      functionId: "teak.ai.metadata.link",
      model: LINK_METADATA_MODEL_ID,
      prompt,
      stage: "ai_metadata",
      system: SYSTEM_PROMPTS.linkAnalysis,
    },
    () =>
      generateWithValidationRetries(LINK_METADATA_MODEL_ID, (attempt) =>
        generateText({
          experimental_telemetry: createAiTelemetrySettings({
            functionId: "teak.ai.metadata.link",
            model: LINK_METADATA_MODEL_ID,
            stage: "ai_metadata",
          }),
          model: LINK_METADATA_MODEL,
          maxRetries: MAX_AI_METADATA_RETRIES,
          maxOutputTokens: MAX_AI_METADATA_OUTPUT_TOKENS,
          // Static system prompt
          system: SYSTEM_PROMPTS.linkAnalysis,
          // Dynamic content last
          prompt: validationRetryPrompt(prompt, attempt),
          output: Output.object({
            schema: aiMetadataSchema,
          }),
        })
      )
  );

  return {
    aiTags: result.output.tags,
    aiSummary: result.output.summary,
  };
};
