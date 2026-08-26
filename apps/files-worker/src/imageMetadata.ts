import {
  buildImageTransformOptions,
  fetchPrivateImageSource,
} from "./imageTransform";
import type { Env } from "./index";

/**
 * Image understanding on Workers AI.
 *
 * Mirrors the Convex pipeline it replaces (packages/convex/workflows/
 * aiMetadata/generators.ts): the existing `detail` rendition feeds the same
 * multimodal model with the same system prompt, JSON output shape, and bounded
 * validation retries. Image bytes never leave the worker.
 */

export const IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export const MAX_IMAGE_METADATA_OUTPUT_TOKENS = 768;
export const MAX_IMAGE_METADATA_VALIDATION_RETRIES = 2;
const MAX_PROMPT_CHARS = 6000;

// Kept in lockstep with SYSTEM_PROMPTS.imageAnalysis in packages/convex/ai/models.ts.
export const IMAGE_ANALYSIS_SYSTEM_PROMPT = `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image. Answer directly without thinking step by step.

Guidelines:
- Tags should be 5-6 single words describing objects, scenes, concepts, emotions (no spaces, no hyphens)
- Summary should be 1-2 sentences describing what the image shows
- Focus on the main visual elements and context
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`;

interface ImageMetadataAi {
  run: (model: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface ImageMetadataResult {
  summary: string;
  tags: string[];
}

const boundPrompt = (content: string): string => {
  if (content.length <= MAX_PROMPT_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_PROMPT_CHARS)}\n\n[Content truncated]`;
};

const validationRetryPrompt = (prompt: string, attempt: number): string =>
  attempt === 0
    ? prompt
    : `JSON validation retry ${attempt}: Return only the required JSON object with tags and summary. Do not include markdown, commentary, or any other keys.\n\n${prompt}`;

const stripJsonFences = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
};

/**
 * Bounded validation equivalent to the zod schema in
 * packages/convex/workflows/aiMetadata/schemas.ts: unknown keys are ignored,
 * tags must be strings, summary must be a string.
 */
export const parseImageMetadata = (raw: string): ImageMetadataResult | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.tags) || typeof record.summary !== "string") {
    return null;
  }
  const tags = record.tags.filter(
    (tag): tag is string => typeof tag === "string"
  );
  if (tags.length === 0 || record.tags.length !== tags.length) {
    return null;
  }
  const summary = record.summary.trim();
  if (!summary) {
    return null;
  }
  return { summary, tags };
};

const extractMessageText = (response: unknown): string | null => {
  if (typeof response === "string") {
    return response;
  }
  if (
    typeof response !== "object" ||
    response === null ||
    !Array.isArray((response as { choices?: unknown }).choices)
  ) {
    return null;
  }
  const message = (
    response as {
      choices?: Array<{ message?: { content?: unknown } }>;
    }
  ).choices?.[0]?.message;
  return typeof message?.content === "string" ? message.content : null;
};

const toDataUrl = (bytes: Uint8Array, mediaType: string): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
};

export const generateImageMetadataForOp = async (
  env: Env,
  {
    origin,
    sourceKey,
    title,
  }: { origin: string; sourceKey: string; title?: string | null },
  now = Math.floor(Date.now() / 1000),
  imageFetch: typeof fetch = fetch as typeof fetch
): Promise<ImageMetadataResult> => {
  // The detail rendition is what the previous Convex path analyzed.
  const renditionResponse = await fetchPrivateImageSource(
    env,
    origin,
    sourceKey,
    buildImageTransformOptions("detail"),
    imageFetch as never,
    now
  );
  if (!renditionResponse.ok) {
    throw new Error("image_transform_failed");
  }
  const contentType =
    renditionResponse.headers.get("content-type")?.split(";")[0]?.trim() ??
    "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error("image_transform_failed");
  }
  const bytes = new Uint8Array(await renditionResponse.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("image_transform_failed");
  }

  const ai = (env as { AI?: ImageMetadataAi }).AI;
  if (!ai) {
    throw new Error("workers_ai_not_configured");
  }

  const basePrompt = boundPrompt(
    title
      ? `Image title: ${title}\n\nAnalyze this image and generate tags and summary:`
      : "Analyze this image and generate tags and summary:"
  );
  const imageDataUrl = toDataUrl(bytes, contentType);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await ai.run(IMAGE_METADATA_MODEL_ID, {
        max_tokens: MAX_IMAGE_METADATA_OUTPUT_TOKENS,
        messages: [
          {
            content: IMAGE_ANALYSIS_SYSTEM_PROMPT,
            role: "system",
          },
          {
            content: [
              {
                text: validationRetryPrompt(basePrompt, attempt),
                type: "text",
              },
              {
                image_url: { url: imageDataUrl },
                type: "image_url",
              },
            ],
            role: "user",
          },
        ],
        response_format: { type: "json_object" },
      });
      const text = extractMessageText(response);
      if (text === null) {
        throw new Error("malformed_workers_ai_response");
      }
      const parsed = parseImageMetadata(text);
      if (!parsed) {
        throw new Error("invalid_image_metadata_output");
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= MAX_IMAGE_METADATA_VALIDATION_RETRIES ||
        ![
          "invalid_image_metadata_output",
          "malformed_workers_ai_response",
        ].includes(message)
      ) {
        throw error;
      }
    }
  }
};
