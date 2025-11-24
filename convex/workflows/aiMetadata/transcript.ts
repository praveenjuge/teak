import { experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";

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

    // Infer a reasonable file extension for OpenAI based on the mime type
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
                : "mp3";

    const arrayBuffer = await response.arrayBuffer();

    // First try direct OpenAI API with explicit filename to avoid SDK dropping filename
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const formData = new FormData();
    formData.append("model", "gpt-4o-mini-transcribe");
    const blob = new Blob([arrayBuffer], { type: mimeType });
    formData.append("file", blob, `audio.${ext}`);

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      },
    );

    if (openaiResponse.ok) {
      const data = (await openaiResponse.json()) as { text?: string };
      console.log("Audio transcription completed successfully (direct)");
      return data.text || null;
    }

    // If direct upload fails, fallback to AI SDK transcribe
    const errText = await openaiResponse.text();
    console.warn(
      `Direct OpenAI transcription failed, falling back to SDK: ${openaiResponse.status} ${openaiResponse.statusText} - ${errText}`,
    );

    const file = new File([arrayBuffer], `audio.${ext}`, { type: mimeType });
    const { text } = await transcribe({
      model: openai.transcription("gpt-4o-mini-transcribe"),
      audio: file as any,
    });
    console.log("Audio transcription completed successfully (sdk)");
    return text;
  } catch (error) {
    console.error("Error generating transcript:", error);
    return null;
  }
};
