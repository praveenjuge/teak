import { groq } from "@ai-sdk/groq";

/**
 * Model for text metadata generation (tags, summaries)
 * Supports prompt caching for 50% cost savings on cached tokens
 */
export const TEXT_METADATA_MODEL = groq("openai/gpt-oss-20b");

/**
 * Model for link content analysis
 * Supports prompt caching for 50% cost savings on cached tokens
 */
export const LINK_METADATA_MODEL = groq("openai/gpt-oss-20b");

/**
 * Model for image/vision analysis
 * Note: Currently does NOT support prompt caching
 * Using Llama 4 Scout for multimodal capabilities
 */
export const IMAGE_METADATA_MODEL = groq("meta-llama/llama-4-scout-17b-16e-instruct");

/**
 * Model for changelog generation (docs)
 * Supports prompt caching for 50% cost savings on cached tokens
 * Using larger model for better quality summaries
 */
export const CHANGELOG_MODEL = groq("openai/gpt-oss-120b");

/**
 * Transcription model for audio content
 * Uses Whisper for fast, accurate speech-to-text
 */
export const TRANSCRIPTION_MODEL = groq.transcription("whisper-large-v3-turbo");

/**
 * System prompts optimized for prompt caching
 * These are placed at the beginning of requests to maximize cache hits
 */
export const SYSTEM_PROMPTS = {
  /**
   * System prompt for text content analysis
   * Static content - will be cached across requests
   */
  textAnalysis: `You are an expert content analyzer. Generate relevant tags and a concise summary for the given content.

Guidelines:
- Tags should be 5-6 specific, relevant single words only (no spaces, no hyphens)
- Summary should be 1-2 sentences that capture the essence
- Focus on the main topics, themes, and key information
- Use clear, searchable language`,

  /**
   * System prompt for image analysis
   * Static content - helps with potential future caching support
   */
  imageAnalysis: `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image.

Guidelines:
- Tags should be 5-6 single words describing objects, scenes, concepts, emotions (no spaces, no hyphens)
- Summary should be 1-2 sentences describing what the image shows
- Focus on the main visual elements and context
- Use clear, searchable language`,

  /**
   * System prompt for web content analysis
   * Static content - will be cached across requests
   */
  linkAnalysis: `You are an expert web content analyzer. Generate relevant tags and a concise summary for the given web page content.

Guidelines:
- Tags should be 5-6 single words capturing main topics, categories, and key concepts (no spaces, no hyphens)
- Include relevant technology, industry, or topic tags where applicable
- Summary should be 1-2 sentences capturing the essence and value of the content
- Focus on what makes this link useful and searchable
- Use clear, specific language that helps with discovery
- Consider the source, author, and context when available`,

  /**
   * System prompt for changelog generation
   * Static content - will be cached across requests
   */
  changelog: `You are writing short changelog posts for Teak, a personal knowledge hub app.
Be concise and direct. Focus only on the most important user-facing changes.
Avoid fluff, marketing speak, or unnecessary detail. Keep everything brief.`,
} as const;
