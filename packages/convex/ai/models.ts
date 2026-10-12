import {
  LINK_ANALYSIS_SYSTEM_PROMPT,
  TEXT_ANALYSIS_SYSTEM_PROMPT,
} from "@teak/files-protocol";

/**
 * Model identifiers and prompts for telemetry and cost estimates. Every model
 * runs in the Files Worker on its Workers AI binding; Convex holds no AI
 * credentials.
 *
 * Text and link metadata use Qwen 3 MoE (3B active), the cheapest capable
 * option on Workers AI; the "/no_think" suffix suppresses reasoning tokens.
 * Image metadata's model and prompt live with its op in the Files Worker
 * (`apps/files-worker/src/imageMetadata.ts`), and transcription uses Whisper
 * large v3 turbo.
 */
export {
  FILES_TRANSCRIPTION_MODEL as TRANSCRIPTION_MODEL_ID,
  LINK_METADATA_MODEL_ID,
  TEXT_METADATA_MODEL_ID,
} from "@teak/files-protocol";

export const SYSTEM_PROMPTS = {
  textAnalysis: TEXT_ANALYSIS_SYSTEM_PROMPT,
  linkAnalysis: LINK_ANALYSIS_SYSTEM_PROMPT,
} as const;
