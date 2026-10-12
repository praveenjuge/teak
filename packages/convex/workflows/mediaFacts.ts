"use node";

import type {
  FilesMediaProbeResult,
  FilesProcessAudioResult,
} from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { TRANSCRIPTION_MODEL_ID } from "../ai/models";
import { observeAiGeneration } from "../ai/telemetry";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { assertR2KeyInNamespace } from "../storage/r2Keys";
import { withBackendErrorCapture } from "../telemetry/posthog";
import { sanitizeTranscript } from "./aiMetadata/transcript";

interface MediaCard {
  _id: string;
  fileKey?: string | null;
  fileMetadata?: {
    duration?: number;
    height?: number;
    mimeType?: string;
    waveform?: unknown;
    width?: number;
  } | null;
}

const positiveNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

/**
 * Record duration and display size for an audio or video card from its
 * container headers (Files Worker `probe-media`). Optional: unsupported
 * containers, older Workers and transient failures leave the card unchanged.
 * Returns the card's duration afterwards, when known.
 */
export const recordMediaFacts = async (
  ctx: Pick<ActionCtx, "runMutation">,
  card: MediaCard,
  kind: "audio" | "video"
): Promise<number | undefined> => {
  const known = card.fileMetadata ?? {};
  const complete =
    known.duration !== undefined &&
    (kind === "audio" ||
      (known.width !== undefined && known.height !== undefined));
  if (!(card.fileKey && isFilesWorkerConfigured()) || complete) {
    return known.duration;
  }
  try {
    const outcome = await callFilesWorkerJson<FilesMediaProbeResult>({
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
      (duration === null ? undefined : Math.round(duration * 1000) / 1000);
    if (duration === null && width === null && height === null) {
      return known.duration;
    }
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
      {
        cardId: card._id as never,
        ...(recordedDuration !== undefined && { duration: recordedDuration }),
        ...(width !== null && { width }),
        ...(height !== null && { height }),
      }
    );
    return recordedDuration;
  } catch (error) {
    console.warn("[mediaFacts] probe-media failed", {
      cardId: card._id,
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

/**
 * Process an audio card in one Files Worker pass (`process-audio`): record its
 * duration and waveform, and return its transcript, or null when the audio
 * has no speech or could not be transcribed. Audio the renderer cannot decode
 * leaves the card unchanged. A busy or unavailable renderer throws, so the
 * metadata step retries.
 */
export const processAudioCard = async (
  ctx: Pick<ActionCtx, "runMutation">,
  card: MediaCard
): Promise<{ durationSeconds?: number; transcript: string | null }> => {
  const known = card.fileMetadata ?? {};
  if (!(card.fileKey && isFilesWorkerConfigured())) {
    return { durationSeconds: known.duration, transcript: null };
  }
  const sourceKey = card.fileKey;
  assertR2KeyInNamespace(sourceKey);
  let processed: FilesProcessAudioResult | null = null;
  let text: string | null = null;
  try {
    ({ text } = await withBackendErrorCapture(
      {
        attributes: { model: TRANSCRIPTION_MODEL_ID, provider: "cloudflare" },
        name: "teak.ai.transcript",
        operation: "gen_ai.generate",
        stage: "transcript",
        surface: "backend",
      },
      () =>
        observeAiGeneration(
          { functionId: "teak.ai.transcript", model: TRANSCRIPTION_MODEL_ID },
          async () => {
            const outcome = await callFilesWorkerJson<FilesProcessAudioResult>({
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
        )
    ));
  } catch (error) {
    // Undecodable audio and failed transcription are expected outcomes: the
    // card keeps its file, and its waveform when there is one.
    if (
      !(
        error instanceof AudioDeclined || error instanceof TranscriptUnavailable
      )
    ) {
      throw error;
    }
    console.log("[mediaFacts] audio processed without a transcript", {
      cardId: card._id,
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
    (duration === null ? undefined : Math.round(duration * 1000) / 1000);
  if (recordedDuration !== known.duration || result.peaks) {
    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
      {
        cardId: card._id as never,
        ...(recordedDuration !== undefined && { duration: recordedDuration }),
        ...(result.peaks && { waveform: result.peaks }),
      }
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
