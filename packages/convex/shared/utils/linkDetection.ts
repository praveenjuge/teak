export type LinkExtractionResult = {
  url?: string;
  cleanedContent: string;
};

export type TextCardResolution = {
  type: "text" | "link";
  url?: string;
  content: string;
};

const URL_ONLY_PATTERN = /^https?:\/\/[^\s]+$/;
const URL_INLINE_PATTERN = /(https?:\/\/[^\s]+)/;

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Mirrors backend URL extraction so frontend and backend stay aligned.
export function extractUrlFromContent(content: string): LinkExtractionResult {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return { cleanedContent: "" };
  }

  if (URL_ONLY_PATTERN.test(trimmedContent)) {
    if (isValidHttpUrl(trimmedContent)) {
      return {
        url: trimmedContent,
        cleanedContent: trimmedContent,
      };
    }

    return { cleanedContent: trimmedContent };
  }

  const urlMatch = trimmedContent.match(URL_INLINE_PATTERN);
  if (urlMatch) {
    const candidate = urlMatch[1];
    if (candidate && isValidHttpUrl(candidate)) {
      return {
        url: candidate,
        cleanedContent: trimmedContent,
      };
    }
  }

  return { cleanedContent: trimmedContent };
}

export function resolveTextCardInput(args: {
  content: string;
  url?: string | null;
}): TextCardResolution {
  const { content, url } = args;
  const trimmedUrl = url?.trim();

  if (trimmedUrl) {
    const extracted = extractUrlFromContent(trimmedUrl);
    if (extracted.url) {
      return {
        type: "link",
        url: extracted.url,
        content,
      };
    }
  }

  const extractedFromContent = extractUrlFromContent(content);
  if (extractedFromContent.url) {
    return {
      type: "link",
      url: extractedFromContent.url,
      content: extractedFromContent.cleanedContent,
    };
  }

  return {
    type: "text",
    content,
  };
}
