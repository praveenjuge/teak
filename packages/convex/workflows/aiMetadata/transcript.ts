"use node";

import { TRANSCRIPTION_MODEL_ID } from "../../ai/models";
import { observeAiGeneration } from "../../ai/telemetry";
import {
  recordBackendAiContent,
  recordBackendHandledFailure,
  recordBackendLog,
  withBackendSpan,
} from "../../telemetry/sentry";

const workersAiRunUrl = () =>
  `https://api.cloudflare.com/client/v4/accounts/${
    process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
  }/ai/run/${TRANSCRIPTION_MODEL_ID}`;

// Transcribe audio bytes via Cloudflare Workers AI. The REST `/ai/run`
// endpoint accepts the raw audio as the request body and returns a
// `{ result: { text } }` envelope.
export const transcribeWorkersAi = async (
  audio: ArrayBuffer,
  mimeType: string
): Promise<string> => {
  const response = await fetch(workersAiRunUrl(), {
    body: new Blob([audio], { type: mimeType }),
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}`,
      "Content-Type": mimeType,
    },
    method: "POST",
  });

  const payload = (await response.json().catch(() => null)) as {
    errors?: { message?: string }[];
    result?: { text?: string };
    success?: boolean;
  } | null;

  if (!(response.ok && payload?.success && payload.result)) {
    const detail =
      payload?.errors?.map((error) => error.message).join("; ") ??
      `${response.status} ${response.statusText}`;
    throw new Error(`Workers AI transcription failed: ${detail}`);
  }

  return payload.result.text ?? "";
};

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
      recordBackendLog("warn", "ai.transcript.unexpected_mime_type", {
        mimeType,
      });
    }

    const arrayBuffer = await response.arrayBuffer();

    // Use Whisper large v3 turbo on Cloudflare Workers AI for fast,
    // cost-effective transcription (billed per audio minute)
    return await withBackendSpan(
      {
        attributes: {
          "audio.byte_length": arrayBuffer.byteLength,
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
          () =>
            transcribeWorkersAi(arrayBuffer, mimeType).then((text) => ({
              text,
            }))
        );
        recordBackendAiContent({ response: text });
        return text;
      }
    );
  } catch (error) {
    recordBackendHandledFailure(error, {
      operation: "gen_ai.generate",
      stage: "transcript",
    });
    return null;
  }
};
