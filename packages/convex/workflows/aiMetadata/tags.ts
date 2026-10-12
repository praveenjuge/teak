/**
 * Normalize AI-generated tags the same way tag search does (trim and
 * lowercase), drop empty entries, and de-duplicate while keeping the model's
 * order. Duplicate tags otherwise reach the UI as duplicate React keys.
 */
export const normalizeAiTags = (tags: readonly string[]): string[] =>
  Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
