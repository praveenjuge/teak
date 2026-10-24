import {
  type FilesImageMetadataResult,
  IMAGE_LANGUAGE_RULES,
  MAX_IMAGE_OCR_CHARS,
  normalizeImageOcrText,
  validateTextMetadata,
} from "@teak/files-protocol";
import { aiRunOptions } from "../ai/aiGateway";
import { meteredAiRun } from "../ai/aiUsage";
import type { Env } from "../index";
import { OpFailure } from "../opFailure";
import {
  buildImageTransformOptions,
  fetchPrivateImageSource,
  IMAGE_RENDITIONS,
} from "./imageTransform";

export const IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export const MAX_IMAGE_METADATA_OUTPUT_TOKENS = 2048;
export const MAX_IMAGE_METADATA_VALIDATION_RETRIES = 2;
const MAX_IMAGE_METADATA_CAPACITY_RETRIES = 2;
const MAX_PROMPT_CHARS = 6000;
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
${IMAGE_LANGUAGE_RULES}

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "...", "text": "...", "language": "xx"}`;

export type ImageMetadataResult = FilesImageMetadataResult;

const boundPrompt = (content: string): string => {
  if (content.length <= MAX_PROMPT_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_PROMPT_CHARS)}\n\n[Content truncated]`;
};

const RETRY_IMAGE_OCR_CHARS = 1000;

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
  return `JSON validation retry ${attempt}: your last answer was not valid JSON, possibly cut off. Return only the required JSON object with tags, summary, language and ${text}. Do not include markdown, commentary, or any other keys.\n\n${prompt}`;
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
    ...(metadata.language ? { language: metadata.language } : {}),
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
  frequencyPenalty?: number;
  functionId: string;
  imageDataUrl: string;
  parse: (raw: string) => T | null;
  prompt: (validationAttempt: number) => string;
  system: string;
}

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
  for (;;) {
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
              // Gemma 4 thinks by default, and its reasoning shares
              // max_tokens: on dense images it spent the whole cap and
              // answered with empty or cut-off content.
              chat_template_kwargs: { enable_thinking: false },
              ...(request.frequencyPenalty === undefined
                ? {}
                : { frequency_penalty: request.frequencyPenalty }),
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
    // Some images send it repeating one line of `text` until the cap cuts
    // the JSON off. A light penalty stops that and still keeps text that
    // really repeats; 0.6 started dropping it.
    frequencyPenalty: 0.3,
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

const imageTextRetryPrompt = (attempt: number): string =>
  attempt === 0
    ? IMAGE_TEXT_PROMPT
    : `JSON validation retry ${attempt}: your last answer was not valid JSON, possibly cut off. Return only the JSON object with text cut to at most ${RETRY_IMAGE_OCR_CHARS} characters. Do not include markdown, commentary, or any other keys.\n\n${IMAGE_TEXT_PROMPT}`;

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
