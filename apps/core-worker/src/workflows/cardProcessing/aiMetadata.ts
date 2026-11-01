import { internal } from "@teak/convex/_generated/api";
import { isVisualStyle, type VisualStyle } from "@teak/convex/shared/constants";
import { HIDDEN_TAG_KEYS } from "@teak/convex/shared/tags";
import {
  buildLinkMetadataPrompt,
  buildTextMetadataPrompt,
  type FilesTextMetadataOpResult,
  normalizeAiLanguage,
  normalizeImageOcrText,
  readFilesAiGenerationFacts,
  readVisualStylesDecision,
  TEXT_METADATA_MODEL_ID,
  validateTextMetadata,
} from "@teak/files-protocol";
import type { FunctionArgs } from "convex/server";
import { observeAiGeneration, type WorkflowTelemetry } from "../telemetry";
import { type CardJob, guardOf } from "./context";

const JSON_VALIDATION_ERROR =
  /failed to validate json|failed_generation|no (?:object|output) generated|response did not match schema|type validation failed/iu;
const PROVIDER_CAPACITY_ERROR =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|status(?: code)? 429|429)\b/iu;
const RASTER_THUMBNAIL_PENDING_ERROR = /waiting for a raster thumbnail/iu;
export const METADATA_UNAVAILABLE = "files_worker_metadata_unavailable";

export const isAiProviderCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return PROVIDER_CAPACITY_ERROR.test(message);
};

export const isAiMetadataDeferredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    PROVIDER_CAPACITY_ERROR.test(message) ||
    JSON_VALIDATION_ERROR.test(message) ||
    RASTER_THUMBNAIL_PENDING_ERROR.test(message) ||
    message === METADATA_UNAVAILABLE
  );
};

export const normalizeAiTags = (tags: readonly string[]): string[] =>
  Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(
          (tag) => tag && !(HIDDEN_TAG_KEYS as readonly string[]).includes(tag)
        )
    )
  );

export interface GeneratedMetadata {
  /** The language the model said the content is in, when it gave a valid one. */
  aiLanguage?: string;
  aiSummary: string;
  aiTags: string[];
}

/** `aiLanguage` as a spread: absent when the model gave none. */
const languageOf = (value: unknown): Pick<GeneratedMetadata, "aiLanguage"> => {
  const aiLanguage = normalizeAiLanguage(value);
  return aiLanguage ? { aiLanguage } : {};
};

type CardAiWrite = FunctionArgs<
  typeof internal.workflows.aiMetadata.mutations.updateCardAI
>;

// Convex's refusal of an argument its validator doesn't know.
const refusesAiLanguage = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("aiLanguage") && /validator/iu.test(message);
};

/**
 * Saves AI output to the card under the run's revision. The Worker deploys
 * before Convex, and a Convex from before `aiLanguage` refuses the whole
 * write, so the write is sent again without the language
 * (`.agents/records/sunset.md`).
 */
export const saveCardAi = async (
  job: CardJob,
  args: CardAiWrite
): Promise<boolean> => {
  const save = (write: CardAiWrite) =>
    job.deps.convex.mutation(
      internal.workflows.aiMetadata.mutations.updateCardAI,
      write,
      guardOf(job)
    );
  try {
    return await save(args);
  } catch (error) {
    if (args.aiLanguage === undefined || !refusesAiLanguage(error)) {
      throw error;
    }
    const { aiLanguage: _unknownToConvex, ...withoutLanguage } = args;
    return await save(withoutLanguage);
  }
};

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
    ...languageOf(result.output.language),
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

export const generateImageMetadataForStoredKey = async (
  job: CardJob,
  sourceKey: string,
  title?: string,
  options: { telemetry?: WorkflowTelemetry } = {}
): Promise<
  GeneratedMetadata & {
    aiOcrText?: string;
    ocrChecked: boolean;
    visualStyles?: VisualStyle[];
  }
> => {
  const outcome = await job.deps.filesOp<{
    language?: unknown;
    summary: string;
    tags: string[];
    text?: unknown;
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
  // The op already tidies the text. It sends none when its answer ran past
  // the output cap, so the image counts as read only when `text` came back.
  const text =
    typeof outcome.data.text === "string" ? outcome.data.text : undefined;
  const aiOcrText =
    text === undefined ? undefined : normalizeImageOcrText(text);
  return {
    aiSummary: outcome.data.summary,
    aiTags: normalizeAiTags(outcome.data.tags),
    ...languageOf(outcome.data.language),
    ...(aiOcrText ? { aiOcrText } : {}),
    ocrChecked: text !== undefined,
    ...(visualStyles ? { visualStyles } : {}),
  };
};

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
