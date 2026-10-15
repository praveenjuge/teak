// Workers AI rejects audio it cannot decode (truncated or mislabeled
// recordings) with error 3030. Retrying the same bytes cannot succeed.
const AUDIO_DECODE_ERROR = /\b3030\b|failed to decode audio/iu;

export const isAudioDecodeError = (error: unknown): boolean => {
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 3030 || code === "3030") {
    return true;
  }
  return AUDIO_DECODE_ERROR.test(
    error instanceof Error ? error.message : String(error)
  );
};
