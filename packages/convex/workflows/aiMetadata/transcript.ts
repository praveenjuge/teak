import { experimental_transcribe as transcribe } from "ai";
import { TRANSCRIPTION_MODEL, TRANSCRIPTION_MODEL_ID } from "../../ai/models";
import { observeAiGeneration } from "../../ai/telemetry";
import {
  recordBackendAiContent,
  withBackendSpan,
} from "../../telemetry/sentry";

// Generate transcript for audio content
export const generateTranscript = async (
  audioUrl: string,
  mimeHint?: string
) => {
  try {
    // Fetch the audio so we can provide a proper filename and mime type
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch audio: ${response.status} ${response.statusText}`
      );
    }

    const mimeType =
      mimeHint || response.headers.get("content-type") || "audio/webm";
    if (!mimeType.startsWith("audio/")) {
      console.warn("Unexpected MIME type while generating transcript", {
        audioUrl,
        mimeType,
      });
    }

    const arrayBuffer = await response.arrayBuffer();

    // Use Groq's whisper-large-v3-turbo for fast, cost-effective transcription
    return await withBackendSpan(
      {
        attributes: {
          "audio.byte_length": arrayBuffer.byteLength,
          model: TRANSCRIPTION_MODEL_ID,
          provider: "groq",
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
          () =>
            transcribe({
              audio: new Uint8Array(arrayBuffer),
              model: TRANSCRIPTION_MODEL,
            })
        );
        recordBackendAiContent({ response: text });
        return text;
      }
    );
  } catch (error) {
    console.error("Error generating transcript:", error);
    return null;
  }
};
