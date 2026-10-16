import { parseTextMetadata } from "@teak/files-protocol";
import { aiRunOptions } from "./aiGateway";
import {
  buildImageTransformOptions,
  fetchPrivateImageSource,
} from "./imageTransform";
import type { Env } from "./index";
import { OpFailure } from "./opFailure";

export const IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export const MAX_IMAGE_METADATA_OUTPUT_TOKENS = 768;
export const MAX_IMAGE_METADATA_VALIDATION_RETRIES = 2;
const MAX_IMAGE_METADATA_CAPACITY_RETRIES = 2;
const MAX_PROMPT_CHARS = 6000;
const CAPACITY_RETRY_BASE_DELAY_MS = 250;
const WORKERS_AI_CAPACITY_ERROR =
  /(?:\b3040\b.*capacity|capacity temporarily exceeded)/iu;

export const IMAGE_ANALYSIS_SYSTEM_PROMPT = `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image. Answer directly without thinking step by step.

Guidelines:
- Tags should be 5-6 single words describing objects, scenes, concepts, emotions (no spaces, no hyphens)
- Summary should be 1-2 sentences describing what the image shows
- Focus on the main visual elements and context
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`;

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

export const parseImageMetadata = (raw: string): ImageMetadataResult | null => {
  const metadata = parseTextMetadata(stripJsonFences(raw));
  const summary = metadata?.summary.trim();
  return metadata?.tags.length && summary
    ? { summary, tags: metadata.tags }
    : null;
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

const isWorkersAiCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return WORKERS_AI_CAPACITY_ERROR.test(message);
};

const waitForCapacityRetry = (attempt: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, CAPACITY_RETRY_BASE_DELAY_MS * 2 ** attempt);
  });

/**
 * The canonical `detail` rendition as one broadly supported raster frame, for
 * models that read images. Animated originals and formats Workers AI cannot
 * decode come back as a single JPEG frame.
 */
export const loadImageForAi = async (
  env: Env,
  origin: string,
  sourceKey: string,
  now = Math.floor(Date.now() / 1000),
  imageFetch: typeof fetch = fetch as typeof fetch
): Promise<{ bytes: Uint8Array; contentType: string; dataUrl: string }> => {
  const renditionResponse = await fetchPrivateImageSource(
    env,
    origin,
    sourceKey,
    {
      ...buildImageTransformOptions("detail"),
      anim: false,
      format: "jpeg",
    },
    imageFetch as never,
    now
  );
  if (!renditionResponse.ok) {
    throw new OpFailure("image_transform_failed");
  }
  const contentType =
    renditionResponse.headers.get("content-type")?.split(";")[0]?.trim() ??
    "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new OpFailure("image_transform_failed");
  }
  const bytes = new Uint8Array(await renditionResponse.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new OpFailure("image_transform_failed");
  }
  return { bytes, contentType, dataUrl: toDataUrl(bytes, contentType) };
};

export const generateImageMetadataForOp = async (
  env: Env,
  {
    image,
    origin,
    sourceKey,
    title,
  }: {
    /** Already loaded with `loadImageForAi`, so it isn't transformed twice. */
    image?: { dataUrl: string };
    origin: string;
    sourceKey: string;
    title?: string | null;
  },
  now = Math.floor(Date.now() / 1000),
  imageFetch: typeof fetch = fetch as typeof fetch
): Promise<ImageMetadataResult> => {
  const { dataUrl: imageDataUrl } =
    image ?? (await loadImageForAi(env, origin, sourceKey, now, imageFetch));

  const ai = env.AI;
  if (!ai) {
    throw new Error("workers_ai_not_configured");
  }

  const basePrompt = boundPrompt(
    title
      ? `Image title: ${title}\n\nAnalyze this image and generate tags and summary:`
      : "Analyze this image and generate tags and summary:"
  );
  let capacityAttempt = 0;
  let validationAttempt = 0;
  while (true) {
    try {
      const response = await ai.run(
        IMAGE_METADATA_MODEL_ID,
        {
          max_tokens: MAX_IMAGE_METADATA_OUTPUT_TOKENS,
          messages: [
            {
              content: IMAGE_ANALYSIS_SYSTEM_PROMPT,
              role: "system",
            },
            {
              content: [
                {
                  text: validationRetryPrompt(basePrompt, validationAttempt),
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
        },
        aiRunOptions(env)
      );
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
        capacityAttempt < MAX_IMAGE_METADATA_CAPACITY_RETRIES &&
        isWorkersAiCapacityError(error)
      ) {
        await waitForCapacityRetry(capacityAttempt);
        capacityAttempt += 1;
        continue;
      }
      if (
        validationAttempt >= MAX_IMAGE_METADATA_VALIDATION_RETRIES ||
        ![
          "invalid_image_metadata_output",
          "malformed_workers_ai_response",
        ].includes(message)
      ) {
        throw error;
      }
      validationAttempt += 1;
    }
  }
};
