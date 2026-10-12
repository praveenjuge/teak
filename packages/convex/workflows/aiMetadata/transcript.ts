"use node";

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
