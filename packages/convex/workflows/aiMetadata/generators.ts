"use node";

import { generateText, Output } from "ai";
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
export const MAX_AI_METADATA_INPUT_CHARS = 6000;
export const MAX_AI_METADATA_OUTPUT_TOKENS = 768;
export const MAX_AI_METADATA_RETRIES = 0;
export const MAX_AI_METADATA_VALIDATION_RETRIES = 2;

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

const validationRetryPrompt = (prompt: string, attempt: number): string => {
  if (attempt === 0) {
    return prompt;
  }
  return boundAiMetadataInput(
    `JSON validation retry ${attempt}: Return only the required JSON object with tags and summary. Do not include markdown, commentary, or any other keys.\n\n${prompt}`
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

export const boundAiMetadataInput = (content: string): string => {
  if (content.length <= MAX_AI_METADATA_INPUT_CHARS) {
    return content;
  }

  const marker = `\n\n[Content truncated from ${content.length} characters]\n\n`;
  const retainedLength = MAX_AI_METADATA_INPUT_CHARS - marker.length;
  const prefixLength = Math.ceil(retainedLength / 2);
  const suffixLength = Math.floor(retainedLength / 2);

  return `${content.slice(0, prefixLength)}${marker}${content.slice(-suffixLength)}`;
};

/**
 * Generate AI metadata for text content
 */
export const generateTextMetadata = async (content: string, title?: string) => {
  const fullContent = title
    ? `Title: ${title}\n\nContent: ${content}`
    : content;
  const prompt = boundAiMetadataInput(
    `Analyze this content and generate tags and summary:\n\n${fullContent}`
  );

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
 * Generate AI metadata for link content
 */
export const generateLinkMetadata = async (content: string, url?: string) => {
  const prompt = boundAiMetadataInput(
    `Analyze this web page content and generate optimized tags and summary for knowledge management:

${content}

${url ? `URL: ${url}` : ""}

Generate tags and summary that will help the user rediscover and understand the value of this content.`
  );
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
