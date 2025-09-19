// Validate and extract URL from content for downstream processing
export function extractUrlFromContent(content: string): {
  url?: string;
  cleanedContent: string;
} {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return { cleanedContent: "" };
  }

  const urlOnlyPattern = /^https?:\/\/[^\s]+$/;
  if (urlOnlyPattern.test(trimmedContent)) {
    try {
      new URL(trimmedContent);
      return {
        url: trimmedContent,
        cleanedContent: trimmedContent,
      };
    } catch {
      return { cleanedContent: trimmedContent };
    }
  }

  const urlMatch = trimmedContent.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    const candidate = urlMatch[1];
    try {
      new URL(candidate);
      return {
        url: candidate,
        cleanedContent: trimmedContent,
      };
    } catch {
      return { cleanedContent: trimmedContent };
    }
  }

  return { cleanedContent: trimmedContent };
}
