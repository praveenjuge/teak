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

class TranscriptionDeclined extends Error {
  constructor() {
    super("transcription_declined");
  }
}

// Generate transcript for audio content
export const generateTranscript = async (
  sourceKey: string,
  mimeHint?: string
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
        return text;
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
