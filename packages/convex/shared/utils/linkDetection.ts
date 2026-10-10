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

// Markdown editors (the web composer's Tiptap serializer) backslash-escape
// punctuation like `_` and `*` and HTML-encode `&`, `<`, and `>` in text. A
// real URL never contains a raw backslash, and WHATWG parsing treats `\` as
// `/`, so keeping the escapes would fetch the wrong page.
const MARKDOWN_ESCAPE_PATTERN = /\\([!-/:-@[-`{-~])/g;
const HTML_ENTITY_PATTERN = /&(amp|lt|gt);/g;
const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">" };

// One pass per pattern, so `&amp;lt;` decodes to `&lt;` and `\\_` to `\_`.
function unescapeMarkdownUrl(candidate: string): string {
  return candidate
    .replace(MARKDOWN_ESCAPE_PATTERN, "$1")
    .replace(
      HTML_ENTITY_PATTERN,
      (entity, name: string) => HTML_ENTITIES[name] ?? entity
    );
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Shared by the backend (createCard) and clients (mobile) so both classify
// pasted text the same way. URL-only content becomes the unescaped URL; text
// around an inline URL is kept as written.
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
    const url = unescapeMarkdownUrl(urlMatch[1]);
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
