"use node";

import { trace } from "@opentelemetry/api";
import type { FilesTranscriptResult } from "@teak/files-protocol";
import { TRANSCRIPTION_MODEL_ID } from "../../ai/models";
import { observeAiGeneration } from "../../ai/telemetry";
import { callFilesWorkerJson } from "../../storage/filesWorkerClient";
import { assertR2KeyInNamespace } from "../../storage/r2";
import {
  recordBackendAiContent,
  recordBackendHandledFailure,
  withBackendSpan,
} from "../../telemetry/sentry";

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

class TranscriptionDeclined extends Error {
  constructor() {
    super("transcription_declined");
  }
}

// Generate transcript for audio content
export const generateTranscript = async (
  sourceKey: string,
  mimeHint?: string,
  options: { durationSeconds?: number } = {}
) => {
  let reportedBySpan = false;
  try {
    assertR2KeyInNamespace(sourceKey);
    reportedBySpan = true;
    return await withBackendSpan(
      {
        attributes: {
          model: TRANSCRIPTION_MODEL_ID,
          provider: "cloudflare",
        },
        name: "teak.ai.transcript",
        operation: "gen_ai.generate",
        stage: "transcript",
        surface: "backend",
      },
      async () => {
        let text: string;
        try {
          ({ text } = await observeAiGeneration(
            {
              functionId: "teak.ai.transcript",
              model: TRANSCRIPTION_MODEL_ID,
            },
            async () => {
              const result = await callFilesWorkerJson<FilesTranscriptResult>({
                op: "transcribe-audio",
                params: { sourceKey, mimeType: mimeHint },
              });
              if (result.kind !== "ok") {
                throw new TranscriptionDeclined();
              }
              trace
                .getActiveSpan()
                ?.setAttribute("audio.byte_length", result.data.byteLength);
              return { text: result.data.text };
            }
          ));
        } catch (error) {
          // Missing, oversized, or undecodable audio is an expected outcome:
          // the card keeps its file without a transcript.
          if (error instanceof TranscriptionDeclined) {
            return null;
          }
          throw error;
        }
        recordBackendAiContent({ response: text });
        return sanitizeTranscript(text, options);
      }
    );
  } catch (error) {
    if (!reportedBySpan) {
      recordBackendHandledFailure(error, {
        operation: "gen_ai.generate",
        stage: "transcript",
      });
    }
    return null;
  }
};
