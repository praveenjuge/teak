import { experimental_transcribe as transcribe } from "ai";
import { TRANSCRIPTION_MODEL } from "../../ai/models";

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

    // Infer a reasonable file extension based on the mime type
    const _ext =
      mimeType.includes("ogg") || mimeType.includes("oga")
        ? "ogg"
        : mimeType.includes("mp3") ||
            mimeType.includes("mpeg") ||
            mimeType.includes("mpga")
          ? "mp3"
          : mimeType.includes("wav")
            ? "wav"
            : mimeType.includes("m4a")
              ? "m4a"
              : mimeType.includes("webm")
                ? "webm"
                : mimeType.includes("flac")
                  ? "flac"
                  : "mp3";

    const arrayBuffer = await response.arrayBuffer();

    // Use Groq's whisper-large-v3-turbo for fast, cost-effective transcription
    const { text } = await transcribe({
      model: TRANSCRIPTION_MODEL,
      audio: new Uint8Array(arrayBuffer),
    });

    return text;
  } catch (error) {
    console.error("Error generating transcript:", error);
    return null;
  }
};
