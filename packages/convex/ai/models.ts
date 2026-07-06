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
export const IMAGE_METADATA_MODEL = groq(
  "meta-llama/llama-4-scout-17b-16e-instruct"
);

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
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`,

  /**
   * System prompt for image analysis
   * Static content - helps with potential future caching support
   */
  imageAnalysis: `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image.

Guidelines:
- Tags should be 5-6 single words describing objects, scenes, concepts, emotions (no spaces, no hyphens)
- Summary should be 1-2 sentences describing what the image shows
- Focus on the main visual elements and context
- Use clear, searchable language

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`,

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
- Consider the source, author, and context when available

Respond with a single JSON object using exactly this shape and no other keys:
{"tags": ["word", "word"], "summary": "..."}`,

  /**
   * System prompt for changelog generation
   * Static content - will be cached across requests
   */
  changelog: `You are writing a public changelog entry for Teak, a personal knowledge hub app. Readers are end users, not engineers.

Editorial rules (non-negotiable):
- Describe user impact only. If a user would not notice the change, do not mention it.
- Do not mention package names, frameworks, libraries, build tooling, bundlers, loaders, ESM/CJS, schemas, data migrations, internal endpoints, refactors, tests, CI, signing/notarization, dependency bumps, or any implementation mechanics. This includes (non-exhaustive): Electron, Vite, Webpack, Forge, Next.js, Astro, Starlight, Expo, Wxt, Hono, Convex (as backend), Better Auth, Groq, Polar, electron-updater, electron-builder, oEmbed, package.json, tsconfig, node_modules.
- Product-facing terms are allowed when users recognize them: desktop, mobile, web, browser extension, Raycast, API, MCP, sync, settings, import/export, updates, sign-in, macOS, Dock, notifications, keychain.
- If the change is only internal tooling, dependency work, refactor, tests, CI, or cleanup, respond with the single token SKIP and nothing else.
- Do not use inline code (backticks) or fenced code blocks. Do not use headers inside the entry.
- Output format: a short title followed by 1 to 3 bullets, each one user-observable outcome in plain English. Trim aggressively.
- If user action is required, state only the clear action the user needs to take.`,

  /**
   * Stricter retry prompt for changelog generation when the first pass
   * violates the editorial rules. Use this in a single regeneration attempt
   * before failing loudly.
   */
  changelogStrictRetry: `You previously produced a changelog entry that violated the editorial rules.

Rewrite it now with ZERO implementation language. Treat the reader as a non-technical end user.

Hard constraints:
- Remove every mention of packages, frameworks, libraries, build tools, bundlers, loaders, ESM/CJS, schemas, migrations, internal endpoints, refactors, tests, CI, signing/notarization, dependency bumps. No exceptions.
- Never use inline code (backticks) or fenced code blocks.
- Output one short title, then 1 to 3 bullets. Each bullet is one user-observable outcome in plain English.
- If the underlying change has no user impact, respond with the single token SKIP and nothing else.`,
} as const;
