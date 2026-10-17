import {
  type FilesImageMetadataResult,
  MAX_IMAGE_OCR_CHARS,
  normalizeImageOcrText,
  validateTextMetadata,
} from "@teak/files-protocol";
import { aiRunOptions } from "./aiGateway";
import { meteredAiRun } from "./aiUsage";
import {
  buildImageTransformOptions,
  fetchPrivateImageSource,
  IMAGE_RENDITIONS,
} from "./imageTransform";
import type { Env } from "./index";
import { OpFailure } from "./opFailure";

export const IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
// Room for most images' text beside the tags and summary. Dense text can
// still run past it; validationRetryPrompt then asks for less.
export const MAX_IMAGE_METADATA_OUTPUT_TOKENS = 2048;
export const MAX_IMAGE_METADATA_VALIDATION_RETRIES = 2;
const MAX_IMAGE_METADATA_CAPACITY_RETRIES = 2;
const MAX_PROMPT_CHARS = 6000;
/** A vision answer that never parsed, after its validation retries. */
export const INVALID_IMAGE_OUTPUT = "invalid_image_metadata_output";
const CAPACITY_RETRY_BASE_DELAY_MS = 250;
const WORKERS_AI_CAPACITY_ERROR =
  /(?:\b3040\b.*capacity|capacity temporarily exceeded)/iu;

export const IMAGE_ANALYSIS_SYSTEM_PROMPT = `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image, and read any text in it. Answer directly without thinking step by step.

Guidelines:
- Tags should be 5-6 single words describing objects, scenes, concepts, emotions (no spaces, no hyphens)
- Summary should be 1-2 sentences describing what the image shows
- Focus on the main visual elements and context
- Use clear, searchable language
- Text is every legible word, number and symbol in the image, copied exactly as written, in reading order, with its line breaks, up to ${MAX_IMAGE_OCR_CHARS} characters. Keep the original language and script; do not translate or correct it.
- Never describe the image in text. If the image has no legible text, text is "".

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "...", "text": "..."}`;

export type ImageMetadataResult = FilesImageMetadataResult;

const boundPrompt = (content: string): string => {
  if (content.length <= MAX_PROMPT_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_PROMPT_CHARS)}\n\n[Content truncated]`;
};

/** Text a retry asks for, so an answer cut off at the token cap fits. */
const RETRY_IMAGE_OCR_CHARS = 1000;

/**
 * The prompt for a validation attempt. Dense text (CJK, code) can run past
 * the output cap and cut the JSON off, so a retry asks for less text, and
 * the last one for none: the tags and summary still save.
 */
export const validationRetryPrompt = (
  prompt: string,
  attempt: number
): string => {
  if (attempt === 0) {
    return prompt;
  }
  const text =
    attempt >= MAX_IMAGE_METADATA_VALIDATION_RETRIES
      ? 'text set to ""'
      : `text cut to at most ${RETRY_IMAGE_OCR_CHARS} characters`;
  return `JSON validation retry ${attempt}: your last answer was not valid JSON, possibly cut off. Return only the required JSON object with tags, summary and ${text}. Do not include markdown, commentary, or any other keys.\n\n${prompt}`;
};

const stripJsonFences = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
};

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const parseImageMetadata = (raw: string): ImageMetadataResult | null => {
  const value = parseJson(stripJsonFences(raw));
  const metadata = validateTextMetadata(value);
  const summary = metadata?.summary.trim();
  if (!(metadata?.tags.length && summary)) {
    return null;
  }
  // `text` is optional, so an older prompt's answer still parses; any other
  // type fails validation and is retried.
  const rawText = (value as { text?: unknown }).text;
  if (rawText !== undefined && typeof rawText !== "string") {
    return null;
  }
  // A read that found nothing is `""`, so callers can tell it from an
  // answer without `text` (an older Worker).
  const text =
    rawText === undefined ? undefined : (normalizeImageOcrText(rawText) ?? "");
  return {
    summary,
    tags: metadata.tags,
    ...(text === undefined ? {} : { text }),
  };
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

export const toDataUrl = (bytes: Uint8Array, mediaType: string): string => {
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
 * The `detail` rendition as one broadly supported raster frame, for models
 * that read images. Animated originals and formats Workers AI cannot decode
 * come back as a single JPEG frame. Unlike the display rendition, the height
 * keeps the same bound as the width, so a tall image stays a small input.
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
      height: IMAGE_RENDITIONS.detail.edge,
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

interface VisionJsonRequest<T> {
  functionId: string;
  imageDataUrl: string;
  /** Undefined when the answer doesn't have the expected shape. */
  parse: (raw: string) => T | null;
  /** The user prompt for a validation attempt (0 is the first try). */
  prompt: (validationAttempt: number) => string;
  system: string;
}

/**
 * One vision call that answers JSON, with the capacity and validation
 * retries every image op shares. Returns the parsed answer and the
 * validation attempt that produced it. Throws `invalid_image_output` once
 * no attempt parses.
 */
const runVisionJson = async <T>(
  env: Env,
  request: VisionJsonRequest<T>
): Promise<{ validationAttempt: number; value: T }> => {
  const ai = env.AI;
  if (!ai) {
    throw new Error("workers_ai_not_configured");
  }
  let capacityAttempt = 0;
  let validationAttempt = 0;
  while (true) {
    try {
      const response = await meteredAiRun(
        env,
        {
          functionId: request.functionId,
          isCapacity: isWorkersAiCapacityError,
          model: IMAGE_METADATA_MODEL_ID,
        },
        () =>
          ai.run(
            IMAGE_METADATA_MODEL_ID,
            {
              max_tokens: MAX_IMAGE_METADATA_OUTPUT_TOKENS,
              messages: [
                { content: request.system, role: "system" },
                {
                  content: [
                    { text: request.prompt(validationAttempt), type: "text" },
                    {
                      image_url: { url: request.imageDataUrl },
                      type: "image_url",
                    },
                  ],
                  role: "user",
                },
              ],
              response_format: { type: "json_object" },
            },
            aiRunOptions(env)
          )
      );
      const text = extractMessageText(response);
      if (text === null) {
        throw new Error("malformed_workers_ai_response");
      }
      const value = request.parse(text);
      if (value === null) {
        throw new Error(INVALID_IMAGE_OUTPUT);
      }
      return { validationAttempt, value };
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
        ![INVALID_IMAGE_OUTPUT, "malformed_workers_ai_response"].includes(
          message
        )
      ) {
        throw error;
      }
      validationAttempt += 1;
    }
  }
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
  const basePrompt = boundPrompt(
    title
      ? `Image title: ${title}\n\nAnalyze this image, generate tags and summary, and read its text:`
      : "Analyze this image, generate tags and summary, and read its text:"
  );
  const { validationAttempt, value } = await runVisionJson(env, {
    functionId: "teak.ai.metadata.image",
    imageDataUrl,
    parse: parseImageMetadata,
    prompt: (attempt) => validationRetryPrompt(basePrompt, attempt),
    system: IMAGE_ANALYSIS_SYSTEM_PROMPT,
  });
  if (validationAttempt >= MAX_IMAGE_METADATA_VALIDATION_RETRIES) {
    // The last attempt asked for no text, so its answer can't say the
    // image has none. Without `text`, callers leave the image unread.
    const { text: _skipped, ...withoutText } = value;
    return withoutText;
  }
  return value;
};

export const IMAGE_TEXT_SYSTEM_PROMPT = `You read the text in images. Answer directly without thinking step by step.

- Copy every legible word, number and symbol exactly as written, in reading order, with its line breaks, up to ${MAX_IMAGE_OCR_CHARS} characters.
- Keep the original language and script; do not translate or correct it.
- Never describe the image. If it has no legible text, text is "".

Respond with a single JSON object using exactly this shape and no other keys:
{"text": "..."}`;

const IMAGE_TEXT_PROMPT = "Read the text in this image:";

/** A text-only retry asks for less, since a long answer may have been cut. */
const imageTextRetryPrompt = (attempt: number): string =>
  attempt === 0
    ? IMAGE_TEXT_PROMPT
    : `JSON validation retry ${attempt}: your last answer was not valid JSON, possibly cut off. Return only the JSON object with text cut to at most ${RETRY_IMAGE_OCR_CHARS} characters. Do not include markdown, commentary, or any other keys.\n\n${IMAGE_TEXT_PROMPT}`;

/** `{ text }` from the text-only prompt, tidied; `""` when none is legible. */
export const parseImageText = (raw: string): { text: string } | null => {
  const value = parseJson(stripJsonFences(raw));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const { text } = value as { text?: unknown };
  return typeof text === "string"
    ? { text: normalizeImageOcrText(text) ?? "" }
    : null;
};

/** The legible text in an image, already loaded as a data URL. */
export const readImageText = async (
  env: Env,
  imageDataUrl: string,
  functionId: string
): Promise<string> => {
  const { value } = await runVisionJson(env, {
    functionId,
    imageDataUrl,
    parse: parseImageText,
    prompt: imageTextRetryPrompt,
    system: IMAGE_TEXT_SYSTEM_PROMPT,
  });
  return value.text;
};

/** `extract-image-text`: the text in a stored image, nothing else. */
export const extractImageTextForOp = async (
  env: Env,
  { origin, sourceKey }: { origin: string; sourceKey: string },
  now = Math.floor(Date.now() / 1000),
  imageFetch: typeof fetch = fetch as typeof fetch
): Promise<{ text: string }> => {
  const { dataUrl } = await loadImageForAi(
    env,
    origin,
    sourceKey,
    now,
    imageFetch
  );
  return { text: await readImageText(env, dataUrl, "teak.ai.ocr.image") };
};
