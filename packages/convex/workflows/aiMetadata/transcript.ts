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
    if (!mimeType.startsWith("audio/")) {
      console.warn("Unexpected MIME type while generating transcript", {
        audioUrl,
        mimeType,
      });
    }

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
