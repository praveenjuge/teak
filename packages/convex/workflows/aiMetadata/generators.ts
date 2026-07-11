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
} from "../../ai/telemetry";
import { aiMetadataSchema } from "./schemas";

/**
 * Force Groq into JSON object mode instead of strict json_schema mode.
 *
 * With `structuredOutputs: true` (the provider default) the JSON schema is
 * enforced server-side. The gpt-oss models occasionally emit the schema
 * definition itself (`$schema`, `properties`, `additionalProperties`, ...)
 * which fails that strict validation with an HTTP 400 (`json_validate_failed`).
 *
 * Disabling it switches the request to `response_format: { type: "json_object" }`.
 * The model still returns JSON, but validation happens client-side against the
 * Zod schema, which strips unknown keys instead of throwing.
 */
const GROQ_JSON_OBJECT_OPTIONS = {
  groq: { structuredOutputs: false },
} as const;

/**
 * Generate AI metadata for text content
 * Uses prompt caching-enabled model (openai/gpt-oss-20b)
 */
export const generateTextMetadata = async (content: string, title?: string) => {
  // Dynamic content placed last for optimal caching
  const fullContent = title
    ? `Title: ${title}\n\nContent: ${content}`
    : content;
  const prompt = `Analyze this content and generate tags and summary:\n\n${fullContent}`;

  const result = await observeAiGeneration(
    {
      functionId: "teak.ai.metadata.text",
      model: TEXT_METADATA_MODEL_ID,
      prompt,
      stage: "ai_metadata",
      system: SYSTEM_PROMPTS.textAnalysis,
    },
    () =>
      generateText({
        experimental_telemetry: createAiTelemetrySettings({
          functionId: "teak.ai.metadata.text",
          model: TEXT_METADATA_MODEL_ID,
          stage: "ai_metadata",
        }),
        model: TEXT_METADATA_MODEL,
        // Static system prompt - will be cached across requests
        system: SYSTEM_PROMPTS.textAnalysis,
        // Dynamic content last for cache optimization
        prompt,
        output: Output.object({
          schema: aiMetadataSchema,
        }),
        // Use Groq JSON object mode instead of strict json_schema. gpt-oss
        // models intermittently echo the schema definition back, which the
        // strict server-side validator rejects with a 400. In json_object mode
        // the SDK validates client-side against the Zod schema (unknown keys are
        // stripped), so leaked schema fields no longer fail the request.
        providerOptions: GROQ_JSON_OBJECT_OPTIONS,
      })
  );

  return {
    aiTags: result.output.tags,
    aiSummary: result.output.summary,
  };
};

/**
 * Generate AI metadata for image content (using vision)
 * Note: Qwen 3.6 vision does NOT currently support prompt caching
 */
export const generateImageMetadata = async (
  imageUrl: string,
  title?: string
) => {
  const prompt = title
    ? `Image title: ${title}\n\nAnalyze this image and generate tags and summary:`
    : "Analyze this image and generate tags and summary:";
  const result = await observeAiGeneration(
    {
      functionId: "teak.ai.metadata.image",
      model: IMAGE_METADATA_MODEL_ID,
      prompt,
      stage: "ai_metadata",
      system: SYSTEM_PROMPTS.imageAnalysis,
    },
    () =>
      generateText({
        experimental_telemetry: createAiTelemetrySettings({
          functionId: "teak.ai.metadata.image",
          model: IMAGE_METADATA_MODEL_ID,
          stage: "ai_metadata",
        }),
        model: IMAGE_METADATA_MODEL,
        // Static system prompt - structured for potential future caching support
        system: SYSTEM_PROMPTS.imageAnalysis,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                // Dynamic text content
                text: prompt,
              },
              {
                type: "image",
                // Dynamic image content
                image: imageUrl,
              },
            ],
          },
        ],
        output: Output.object({
          schema: aiMetadataSchema,
        }),
        providerOptions: GROQ_JSON_OBJECT_OPTIONS,
      })
  );

  return {
    aiTags: result.output.tags,
    aiSummary: result.output.summary,
  };
};

/**
 * Generate AI metadata for link content
 * Uses prompt caching-enabled model (openai/gpt-oss-20b)
 */
export const generateLinkMetadata = async (content: string, url?: string) => {
  const prompt = `Analyze this web page content and generate optimized tags and summary for knowledge management:

${content}

${url ? `\nURL: ${url}` : ""}

Generate tags and summary that will help the user rediscover and understand the value of this content.`;
  const result = await observeAiGeneration(
    {
      functionId: "teak.ai.metadata.link",
      model: LINK_METADATA_MODEL_ID,
      prompt,
      stage: "ai_metadata",
      system: SYSTEM_PROMPTS.linkAnalysis,
    },
    () =>
      generateText({
        experimental_telemetry: createAiTelemetrySettings({
          functionId: "teak.ai.metadata.link",
          model: LINK_METADATA_MODEL_ID,
          stage: "ai_metadata",
        }),
        model: LINK_METADATA_MODEL,
        // Static system prompt - will be cached across requests
        system: SYSTEM_PROMPTS.linkAnalysis,
        // Dynamic content last for cache optimization
        prompt,
        output: Output.object({
          schema: aiMetadataSchema,
        }),
        providerOptions: GROQ_JSON_OBJECT_OPTIONS,
      })
  );

  return {
    aiTags: result.output.tags,
    aiSummary: result.output.summary,
  };
};
