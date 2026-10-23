export interface LinkExtractionResult {
  cleanedContent: string;
  url?: string;
}

export interface TextCardResolution {
  content: string;
  type: "text" | "link";
  url?: string;
}

const URL_ONLY_PATTERN = /^https?:\/\/[^\s]+$/;
const URL_INLINE_PATTERN = /(https?:\/\/[^\s]+)/;

const MARKDOWN_ESCAPE_PATTERN = /\\([!-/:-@[-`{-~])/g;
const HTML_ENTITY_PATTERN = /&(amp|lt|gt);/g;
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">" };

function unescapeMarkdownUrl(candidate: string): string {
  return candidate
    .replace(MARKDOWN_ESCAPE_PATTERN, "$1")
    .replace(
      HTML_ENTITY_PATTERN,
      (entity, name: string) => HTML_ENTITIES[name] ?? entity
    );
}

const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "'", '"']);
const OPENING_BRACKET: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
  ">": "<",
};

const count = (text: string, character: string) =>
  text.split(character).length - 1;

/**
 * A URL written inside a sentence, less the punctuation that ends the
 * sentence or closes a bracket around it: `(https://x.com/a).` is
 * `https://x.com/a`. A closing bracket the URL opened stays, as in
 * `https://en.wikipedia.org/wiki/Teak_(wood)`.
 */
export function trimTrailingUrlPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    const opening = OPENING_BRACKET[last];
    const head = url.slice(0, end);
    if (
      TRAILING_PUNCTUATION.has(last) ||
      (opening && count(head, last) > count(head, opening))
    ) {
      end -= 1;
    } else {
      break;
    }
  }
  return url.slice(0, end);
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractUrlFromContent(content: string): LinkExtractionResult {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return { cleanedContent: "" };
  }

  if (URL_ONLY_PATTERN.test(trimmedContent)) {
    const url = unescapeMarkdownUrl(trimmedContent);
    if (isValidHttpUrl(url)) {
      return {
        url,
        cleanedContent: url,
      };
    }

    return { cleanedContent: trimmedContent };
  }

  const urlMatch = trimmedContent.match(URL_INLINE_PATTERN);
  if (urlMatch?.[1]) {
    const url = trimTrailingUrlPunctuation(unescapeMarkdownUrl(urlMatch[1]));
    if (isValidHttpUrl(url)) {
      return {
        url,
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
