import {
  FILES_AUDIO_MAX_BYTES,
  FILES_TRANSCRIPT_MAX_BYTES,
  FILES_TRANSCRIPTION_MODEL,
  type FilesTranscriptParams,
  type FilesTranscriptResult,
} from "@teak/files-protocol";
import { isValidUploadKey } from "./upload";

export async function transcribeAudio(
  env: {
    BUCKET: R2Bucket;
    AI?: {
      run: (model: string, args: Record<string, unknown>) => Promise<unknown>;
    };
  },
  input: unknown
): Promise<FilesTranscriptResult> {
  if (!input || typeof input !== "object") {
    throw new Error("invalid_transcript_params");
  }
  const params = input as FilesTranscriptParams;
  if (
    typeof params.sourceKey !== "string" ||
    !isValidUploadKey(params.sourceKey) ||
    (params.mimeType !== undefined &&
      (typeof params.mimeType !== "string" || params.mimeType.length > 255))
  ) {
    throw new Error("invalid_transcript_params");
  }
  const source = await env.BUCKET.get(params.sourceKey);
  if (!source) {
    throw new Error("source_not_found");
  }
  if (source.size > FILES_AUDIO_MAX_BYTES) {
    await source.body.cancel();
    throw new Error("source_too_large");
  }
  const mimeType =
    params.mimeType || source.httpMetadata?.contentType || "audio/webm";
  if (!mimeType.startsWith("audio/")) {
    console.warn("ai.transcript.unexpected_mime_type", { mimeType });
  }
  if (!env.AI) {
    await source.body.cancel();
    throw new Error("ai_binding_missing");
  }
  // The first-class AI binding streams the R2 body with its content type.
  // This preserves the 100 MiB upload limit without a base64 copy in memory.
  const result = (await env.AI.run(FILES_TRANSCRIPTION_MODEL, {
    audio: { body: source.body, contentType: mimeType },
  })) as { text?: unknown };
  const text = result?.text ?? "";
  if (typeof text !== "string") {
    throw new Error("transcription_invalid_response");
  }
  if (new TextEncoder().encode(text).byteLength > FILES_TRANSCRIPT_MAX_BYTES) {
    throw new Error("source_too_large");
  }
  return {
    text,
    byteLength: source.size,
    mimeType,
    sourceEtag: source.httpEtag,
  };
}
