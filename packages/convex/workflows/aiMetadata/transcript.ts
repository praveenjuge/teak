"use node";

import { trace } from "@opentelemetry/api";
import { TRANSCRIPTION_MODEL_ID } from "../../ai/models";
import { observeAiGeneration } from "../../ai/telemetry";
import { callFilesWorkerJson } from "../../storage/filesWorkerClient";
import { assertR2KeyInNamespace } from "../../storage/r2";
import {
  recordBackendAiContent,
  recordBackendHandledFailure,
  withBackendSpan,
} from "../../telemetry/sentry";

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
        const { text } = await observeAiGeneration(
          {
            functionId: "teak.ai.transcript",
            model: TRANSCRIPTION_MODEL_ID,
          },
          async () => {
            const result = await callFilesWorkerJson({
              op: "transcribe-audio",
              params: { sourceKey, mimeType: mimeHint },
            });
            if (result.kind !== "ok") {
              throw new Error("transcription_rejected");
            }
            trace
              .getActiveSpan()
              ?.setAttribute("audio.byte_length", result.data.byteLength);
            return { text: result.data.text };
          }
        );
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
