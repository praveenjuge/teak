import { experimental_transcribe as transcribe } from "ai";
import { groq } from "@ai-sdk/groq";

// Generate transcript for audio content
export const generateTranscript = async (audioUrl: string, mimeHint?: string) => {
  try {
    console.log("Starting audio transcription for:", audioUrl);

    // Fetch the audio so we can provide a proper filename and mime type
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch audio: ${response.status} ${response.statusText}`,
      );
    }

    const mimeType =
      mimeHint || response.headers.get("content-type") || "audio/webm";
    console.log("Transcription mimeType/ext hint:", mimeType);

    // Infer a reasonable file extension based on the mime type
    const ext =
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
      model: groq.transcription("whisper-large-v3-turbo"),
      audio: new Uint8Array(arrayBuffer),
    });

    console.log("Audio transcription completed successfully");
    return text;
  } catch (error) {
    console.error("Error generating transcript:", error);
    return null;
  }
};
