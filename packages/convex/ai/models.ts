import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Cloudflare Workers AI accessed through its OpenAI-compatible REST endpoint
 * (`/ai/v1/chat/completions`). Credentials come from the Convex environment:
 * CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (token needs Workers AI run
 * permission).
 */
export const workersAi = createOpenAICompatible({
  apiKey: process.env.CLOUDFLARE_API_TOKEN ?? "",
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${
    process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
  }/ai/v1`,
  name: "cloudflare-workers-ai",
});

/**
 * Model for text metadata generation (tags, summaries)
 * Qwen 3 MoE (3B active) — cheapest capable option on Workers AI.
 * The "/no_think" suffix appended to prompts suppresses reasoning tokens.
 */
export const TEXT_METADATA_MODEL = workersAi("@cf/qwen/qwen3-30b-a3b-fp8");
export const TEXT_METADATA_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8" as const;

/**
 * Model for link content analysis
 */
export const LINK_METADATA_MODEL = workersAi("@cf/qwen/qwen3-30b-a3b-fp8");
export const LINK_METADATA_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8" as const;

/**
 * Model for image/vision analysis
 * Gemma 4 26B A4B — multimodal with strong OCR/UI understanding at a low
 * price point. Reasoning is kept on but nudged off via the system prompt.
 */
export const IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it" as const;
export const IMAGE_METADATA_MODEL = workersAi(IMAGE_METADATA_MODEL_ID);

/**
 * Transcription model for audio content
 * Whisper large v3 turbo — billed per audio minute via the REST `/ai/run`
 * endpoint (see workflows/aiMetadata/transcript.ts).
 */
export const TRANSCRIPTION_MODEL_ID =
  "@cf/openai/whisper-large-v3-turbo" as const;

/**
 * System prompts optimized for reuse across requests.
 */
export const SYSTEM_PROMPTS = {
  /**
   * System prompt for text content analysis
   */
  textAnalysis: `You are an expert content analyzer. Generate relevant tags and a concise summary for the given content. /no_think

Guidelines:
- Tags should be 5-6 specific, relevant single words only (no spaces, no hyphens)
- Summary should be 1-2 sentences that capture the essence
- Focus on the main topics, themes, and key information
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`,

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
  linkAnalysis: `You are an expert web content analyzer. Generate relevant tags and a concise summary for the given web page content. /no_think

Guidelines:
- Tags should be 5-6 single words capturing main topics, categories, and key concepts (no spaces, no hyphens)
- Include relevant technology, industry, or topic tags where applicable
- Summary should be 1-2 sentences capturing the essence and value of the content
- Focus on what makes this link useful and searchable
- Use clear, specific language that helps with discovery
- Consider the source, author, and context when available

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`,
} as const;
