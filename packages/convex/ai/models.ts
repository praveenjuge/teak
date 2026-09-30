import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  LINK_ANALYSIS_SYSTEM_PROMPT,
  LINK_METADATA_MODEL_ID,
  TEXT_ANALYSIS_SYSTEM_PROMPT,
  TEXT_METADATA_MODEL_ID,
} from "@teak/files-protocol";
import { env } from "../_generated/server";

/**
 * Cloudflare Workers AI accessed through its OpenAI-compatible REST endpoint
 * (`/ai/v1/chat/completions`). Credentials come from the Convex environment:
 * CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (token needs Workers AI run
 * permission).
 */
export const workersAi = createOpenAICompatible({
  apiKey: env.CLOUDFLARE_API_TOKEN ?? "",
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${
    env.CLOUDFLARE_ACCOUNT_ID ?? ""
  }/ai/v1`,
  name: "cloudflare-workers-ai",
});

/**
 * Model for text metadata generation (tags, summaries)
 * Qwen 3 MoE (3B active) — cheapest capable option on Workers AI.
 * The "/no_think" suffix appended to prompts suppresses reasoning tokens.
 */
export const TEXT_METADATA_MODEL = workersAi(TEXT_METADATA_MODEL_ID);

/**
 * Model for link content analysis
 */
export const LINK_METADATA_MODEL = workersAi(LINK_METADATA_MODEL_ID);

/**
 * Model for image/vision analysis
 * Gemma 4 26B A4B — multimodal with strong OCR/UI understanding at a low
 * price point. Reasoning is kept on but nudged off via the system prompt.
 */
export const IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it" as const;
export const IMAGE_METADATA_MODEL = workersAi(IMAGE_METADATA_MODEL_ID);

/**
 * Transcription model for audio content
 * Whisper large v3 turbo via the files worker AI binding.
 */
export { FILES_TRANSCRIPTION_MODEL as TRANSCRIPTION_MODEL_ID } from "@teak/files-protocol";

/**
 * System prompts optimized for reuse across requests.
 */
export const SYSTEM_PROMPTS = {
  /**
   * System prompt for text content analysis
   */
  textAnalysis: TEXT_ANALYSIS_SYSTEM_PROMPT,

  /**
   * System prompt for image analysis
   */
  imageAnalysis: `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image. Answer directly without thinking step by step.

Guidelines:
- Tags should be 5-6 single words describing objects, scenes, concepts, emotions (no spaces, no hyphens)
- Summary should be 1-2 sentences describing what the image shows
- Focus on the main visual elements and context
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`,

  /**
   * System prompt for web content analysis
   */
  linkAnalysis: LINK_ANALYSIS_SYSTEM_PROMPT,
} as const;

export {
  LINK_METADATA_MODEL_ID,
  TEXT_METADATA_MODEL_ID,
} from "@teak/files-protocol";
