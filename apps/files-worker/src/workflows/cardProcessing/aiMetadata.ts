import { isVisualStyle, type VisualStyle } from "@teak/convex/shared/constants";
import {
  buildLinkMetadataPrompt,
  buildTextMetadataPrompt,
  type FilesTextMetadataOpResult,
  readFilesAiGenerationFacts,
  readVisualStylesDecision,
  TEXT_METADATA_MODEL_ID,
  validateTextMetadata,
} from "@teak/files-protocol";
import { observeAiGeneration, type WorkflowTelemetry } from "../telemetry";
import type { CardJob } from "./context";

const JSON_VALIDATION_ERROR =
  /failed to validate json|failed_generation|no (?:object|output) generated|response did not match schema|type validation failed/iu;
const PROVIDER_CAPACITY_ERROR =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|status(?: code)? 429|429)\b/iu;
const RASTER_THUMBNAIL_PENDING_ERROR = /waiting for a raster thumbnail/iu;
export const METADATA_UNAVAILABLE = "files_worker_metadata_unavailable";

/** Workers AI is out of capacity (`files_worker_ai: rate limit reached 429`). */
export const isAiProviderCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return PROVIDER_CAPACITY_ERROR.test(message);
};

/**
 * Failures the AI backfill retries later instead of the step: capacity,
 * output that never validated, a source the Worker cannot read yet.
 */
export const isAiMetadataDeferredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    PROVIDER_CAPACITY_ERROR.test(message) ||
    JSON_VALIDATION_ERROR.test(message) ||
    RASTER_THUMBNAIL_PENDING_ERROR.test(message) ||
    message === METADATA_UNAVAILABLE
  );
};

/**
 * Normalize AI-generated tags the same way tag search does (trim and
 * lowercase), drop empty entries, and de-duplicate while keeping the model's
 * order. Duplicate tags otherwise reach the UI as duplicate React keys.
 */
export const normalizeAiTags = (tags: readonly string[]): string[] =>
  Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );

export interface GeneratedMetadata {
  aiSummary: string;
  aiTags: string[];
}

const generateWorkerMetadata = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  op: "generate-text-metadata" | "generate-link-metadata",
  prompt: string
): Promise<GeneratedMetadata> => {
  const isLink = op === "generate-link-metadata";
  const result = await observeAiGeneration(
    telemetry,
    {
      functionId: isLink ? "teak.ai.metadata.link" : "teak.ai.metadata.text",
      model: TEXT_METADATA_MODEL_ID,
      traceId: job.cardId,
    },
    async () => {
      const outcome = await job.deps.filesOp<FilesTextMetadataOpResult>({
        op,
        params: { prompt },
      });
      if (outcome.kind === "fallback") {
        throw new Error(METADATA_UNAVAILABLE);
      }
      const facts = readFilesAiGenerationFacts(outcome.data);
      if (!facts) {
        throw new Error("failed to validate JSON metadata diagnostics");
      }
      const metadata = validateTextMetadata(outcome.data);
      if (!metadata) {
        throw new Error("failed to validate JSON metadata response");
      }
      return { output: metadata, usage: facts.usage };
    }
  );
  return {
    aiSummary: result.output.summary,
    aiTags: normalizeAiTags(result.output.tags),
  };
};

export const generateTextMetadata = (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  content: string,
  title?: string
) =>
  generateWorkerMetadata(
    job,
    telemetry,
    "generate-text-metadata",
    buildTextMetadataPrompt(content, title)
  );

export const generateLinkMetadata = (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  content: string,
  url?: string
) =>
  generateWorkerMetadata(
    job,
    telemetry,
    "generate-link-metadata",
    buildLinkMetadataPrompt(content, url)
  );

/**
 * AI metadata for a stored image from the `generate-image-metadata` op,
 * which reads the image's `detail` rendition. A source the op declines
 * (missing, too large, unsupported) defers like a thumbnail still pending.
 */
export const generateImageMetadataForStoredKey = async (
  job: CardJob,
  sourceKey: string,
  title?: string,
  /** With telemetry, the op also asks Clef for the image's visual styles. */
  options: { telemetry?: WorkflowTelemetry } = {}
): Promise<GeneratedMetadata & { visualStyles?: VisualStyle[] }> => {
  const outcome = await job.deps.filesOp<{
    summary: string;
    tags: string[];
    visualStyles?: unknown;
  }>({
    op: "generate-image-metadata",
    params: {
      sourceKey,
      ...(title ? { title } : {}),
      ...(options.telemetry ? { visualStyles: true } : {}),
    },
  });
  if (outcome.kind === "fallback") {
    throw new Error(
      "Image analysis is waiting for a raster thumbnail (worker unavailable)"
    );
  }
  const visualStyles = options.telemetry
    ? await readClefVisualStyles(
        job,
        options.telemetry,
        outcome.data.visualStyles
      )
    : undefined;
  return {
    aiSummary: outcome.data.summary,
    aiTags: normalizeAiTags(outcome.data.tags),
    ...(visualStyles ? { visualStyles } : {}),
  };
};

/**
 * Clef's styles from the image op, when it ran and replied validly; else
 * `undefined`, so the caller falls back to the tag aliases. The op made the
 * Clef call, so its `$ai_generation` is recorded here.
 */
const readClefVisualStyles = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  value: unknown
): Promise<VisualStyle[] | undefined> => {
  if (value === undefined) {
    return;
  }
  const decision = readVisualStylesDecision(value, isVisualStyle);
  if (!decision) {
    return;
  }
  await observeAiGeneration(
    telemetry,
    {
      functionId: "teak.ai.decision.decide-visual-styles",
      model: decision.model,
      traceId: job.cardId,
    },
    () => Promise.resolve({ usage: decision.usage })
  );
  return decision.styles as VisualStyle[];
};

// Whisper invents these closing lines for silence, tones and beeps. A
// transcript made only of them on short audio is not speech.
const WHISPER_HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thank you very much",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thanks for listening",
  "thank you for listening",
  "please subscribe",
  "like and subscribe",
  "subtitles by the amaraorg community",
  "bye",
  "you",
]);
const SHORT_AUDIO_MAX_SECONDS = 30;
const NON_WORD_CHARACTERS = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN = /\s+/gu;
const SENTENCE_BREAK = /[.!?\n]+/u;

const normalizeTranscriptPhrase = (value: string) =>
  value
    .toLowerCase()
    .replace(NON_WORD_CHARACTERS, "")
    .replace(WHITESPACE_RUN, " ")
    .trim();

/**
 * Returns the transcript to store, or null when the audio has no speech: an
 * empty or punctuation-only result, or (for short or unknown-length audio)
 * nothing but known Whisper hallucination phrases.
 */
export const sanitizeTranscript = (
  text: string | null | undefined,
  options: { durationSeconds?: number } = {}
): string | null => {
  const trimmed = text?.trim() ?? "";
  if (!normalizeTranscriptPhrase(trimmed)) {
    return null;
  }
  const { durationSeconds } = options;
  const isShortAudio =
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= SHORT_AUDIO_MAX_SECONDS;
  if (isShortAudio) {
    const phrases = trimmed
      .split(SENTENCE_BREAK)
      .map(normalizeTranscriptPhrase)
      .filter(Boolean);
    if (phrases.every((phrase) => WHISPER_HALLUCINATION_PHRASES.has(phrase))) {
      return null;
    }
  }
  return text ?? null;
};
