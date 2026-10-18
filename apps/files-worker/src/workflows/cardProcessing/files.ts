import { internal } from "@teak/convex/_generated/api";
import {
  documentTextObjectKey,
  isExtractedTextTruncated,
  searchPrefix,
} from "@teak/convex/card/documentTextFormat";
import type {
  FileFormat,
  FilePreviewFacts,
} from "@teak/convex/shared/fileFormats";
import {
  type ExtractedDocumentText,
  extractDocumentFileText,
  FILES_INSPECT_MAX_ARCHIVE_BYTES,
  FILES_INSPECT_MAX_SOURCE_BYTES,
  FILES_TRANSCRIPTION_MODEL,
  type FilesInspectResult,
  type FilesMediaProbeResult,
  type FilesPdfOcrResult,
  type FilesProcessAudioResult,
  filesCardKeyPrefix,
  normalizeImageOcrText,
} from "@teak/files-protocol";
import { sha256Hex } from "../../lib";
import { observeAiGeneration, type WorkflowTelemetry } from "../telemetry";
import { sanitizeTranscript } from "./aiMetadata";
import {
  type CardDoc,
  type CardJob,
  ensureObjectOwnership,
  guardOf,
  isKeyInUserNamespace,
  type LoadedCard,
} from "./context";

const positiveNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

const roundedSeconds = (seconds: number) => Math.round(seconds * 1000) / 1000;

export const recordMediaFacts = async (
  job: CardJob,
  card: CardDoc,
  kind: "audio" | "video"
): Promise<number | undefined> => {
  const known = card.fileMetadata ?? {};
  const complete =
    known.duration !== undefined &&
    (kind === "audio" ||
      (known.width !== undefined && known.height !== undefined));
  if (!card.fileKey || complete) {
    return known.duration;
  }
  try {
    const outcome = await job.deps.filesOp<FilesMediaProbeResult>({
      op: "probe-media",
      params: { sourceKey: card.fileKey },
    });
    if (outcome.kind !== "ok") {
      return known.duration;
    }
    const duration = positiveNumber(outcome.data.durationSeconds);
    const width = kind === "video" ? positiveNumber(outcome.data.width) : null;
    const height =
      kind === "video" ? positiveNumber(outcome.data.height) : null;
    const recordedDuration =
      known.duration ??
      (duration === null ? undefined : roundedSeconds(duration));
    if (duration === null && width === null && height === null) {
      return known.duration;
    }
    await job.deps.convex.mutation(
      internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
      {
        cardId: job.cardId,
        ...(recordedDuration !== undefined && { duration: recordedDuration }),
        ...(width !== null && { width }),
        ...(height !== null && { height }),
      },
      guardOf(job)
    );
    return recordedDuration;
  } catch (error) {
    if (error instanceof Error && error.name === "NonRetryableError") {
      throw error;
    }
    console.warn("[cardProcessing/media] probe-media failed", {
      cardId: job.cardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return known.duration;
  }
};

class AudioDeclined extends Error {
  constructor(message: string) {
    super(`audio_declined:${message}`);
  }
}

class TranscriptUnavailable extends Error {
  constructor(reason: string) {
    super(`transcript_unavailable:${reason}`);
  }
}

export const processAudioCard = async (
  job: CardJob,
  telemetry: WorkflowTelemetry,
  loaded: LoadedCard,
  { recordFacts = true }: { recordFacts?: boolean } = {}
): Promise<{ durationSeconds?: number; transcript: string | null }> => {
  const { card } = loaded;
  const known = card.fileMetadata ?? {};
  if (!card.fileKey) {
    return { durationSeconds: known.duration, transcript: null };
  }
  const sourceKey = card.fileKey;
  if (!isKeyInUserNamespace(loaded.keyPrefix, sourceKey)) {
    throw new Error("invalid_storage_key_namespace");
  }
  let processed: FilesProcessAudioResult | null = null;
  let text: string | null = null;
  try {
    ({ text } = await observeAiGeneration(
      telemetry,
      {
        functionId: "teak.ai.transcript",
        model: FILES_TRANSCRIPTION_MODEL,
        traceId: job.cardId,
      },
      async () => {
        const outcome = await job.deps.filesOp<FilesProcessAudioResult>({
          op: "process-audio",
          params: {
            sourceKey,
            transcribe: true,
            ...(known.mimeType && { mimeType: known.mimeType }),
          },
        });
        if (outcome.kind !== "ok") {
          throw new AudioDeclined(outcome.message);
        }
        processed = outcome.data;
        const { transcript } = outcome.data;
        if (transcript.status !== "completed") {
          throw new TranscriptUnavailable(transcript.reason);
        }
        return { text: transcript.text };
      }
    ));
  } catch (error) {
    if (
      !(
        error instanceof AudioDeclined || error instanceof TranscriptUnavailable
      )
    ) {
      throw error;
    }
    console.log("[cardProcessing/media] audio processed without a transcript", {
      cardId: job.cardId,
      reason: error.message,
    });
  }
  const result = processed as FilesProcessAudioResult | null;
  if (!result) {
    return { durationSeconds: known.duration, transcript: null };
  }
  const duration = positiveNumber(result.facts.durationSeconds);
  const recordedDuration =
    known.duration ??
    (duration === null ? undefined : roundedSeconds(duration));
  if (recordFacts && (recordedDuration !== known.duration || result.peaks)) {
    await job.deps.convex.mutation(
      internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
      {
        cardId: job.cardId,
        ...(recordedDuration !== undefined && { duration: recordedDuration }),
        ...(result.peaks && { waveform: result.peaks }),
      },
      guardOf(job)
    );
  }
  return {
    durationSeconds: recordedDuration,
    transcript:
      text === null
        ? null
        : sanitizeTranscript(text, { durationSeconds: recordedDuration }),
  };
};

export const buildFilePreviewFactsForKey = async (
  job: CardJob,
  sourceKey: string,
  format: FileFormat
): Promise<FilePreviewFacts | null> => {
  let mode: "css" | "zip" | null = null;
  if (["zip", "word", "powerpoint"].includes(format.id)) {
    mode = "zip";
  } else if (format.kind === "tokens" && format.language === "css") {
    mode = "css";
  }
  if (!mode) {
    return null;
  }
  const outcome = await job.deps.filesOp<FilesInspectResult>({
    op: "inspect",
    params: {
      formatId: format.id,
      maxBytes:
        mode === "zip"
          ? FILES_INSPECT_MAX_ARCHIVE_BYTES
          : FILES_INSPECT_MAX_SOURCE_BYTES,
      mode,
      sourceKey,
    },
  });
  return outcome.kind === "ok"
    ? ((outcome.data.facts as FilePreviewFacts | undefined) ?? null)
    : null;
};

export const extractFileTextForKey = (
  job: CardJob,
  sourceKey: string,
  format: FileFormat,
  card: { fileMetadata?: { kind?: string } | null }
): Promise<ExtractedDocumentText> =>
  extractDocumentFileText(
    (params) =>
      job.deps.filesOp<FilesInspectResult>({
        op: "inspect",
        params: { ...params },
      }),
    sourceKey,
    format,
    card
  );

export const readScannedPdfText = async (
  job: CardJob,
  sourceKey: string
): Promise<string> => {
  const outcome = await job.deps.filesOp<FilesPdfOcrResult>({
    op: "ocr-pdf-pages",
    params: { sourceKey },
  });
  return outcome.kind === "ok"
    ? (normalizeImageOcrText(outcome.data.text) ?? "")
    : "";
};

export const storeDocumentText = async (
  job: CardJob,
  loaded: LoadedCard,
  extracted: { pageCount?: number; text: string }
): Promise<{ charCount: number; stored: boolean }> => {
  const { card } = loaded;
  const text = extracted.text.trim();
  if (!text) {
    return { charCount: 0, stored: false };
  }
  const key = documentTextObjectKey(
    filesCardKeyPrefix(loaded.keyPrefix, card.userId),
    card._id,
    await sha256Hex(text)
  );
  const charCount = Array.from(text).length;
  if (card.documentTextKey !== key) {
    await ensureObjectOwnership(job, card.userId, key);
    await job.env.BUCKET.put(key, text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
  }
  await job.deps.convex.mutation(
    internal.card.documentText.saveDocumentText,
    {
      cardId: job.cardId,
      charCount,
      key,
      text: searchPrefix(text),
      truncated: isExtractedTextTruncated(text, extracted.pageCount),
    },
    guardOf(job)
  );
  return { charCount, stored: true };
};
