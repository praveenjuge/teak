const MAX_PREVIEW_LENGTH = 500;

// Markdown backslash escapes, e.g. `my\_file` or `2\*3`. The editor writes
// these for literal punctuation, so they are swapped for private-use
// placeholders before any stripping (otherwise the emphasis rules would pair
// the escaped markers) and restored as plain characters at the end.
const ESCAPED_CHARACTER = /\\([\\`*_{}[\]()#+\-.!~|>])/g;
const PLACEHOLDER_BASE = "\ue000".charCodeAt(0);
const PLACEHOLDER = /[\ue000-\ue07f]/g;

function protectEscapes(text: string): string {
  return text.replace(ESCAPED_CHARACTER, (_match, character: string) =>
    String.fromCharCode(PLACEHOLDER_BASE + character.charCodeAt(0))
  );
}

function restoreEscapes(text: string): string {
  return text.replace(PLACEHOLDER, (placeholder) =>
    String.fromCharCode(placeholder.charCodeAt(0) - PLACEHOLDER_BASE)
  );
}

/**
 * Convert markdown to plain text for compact card previews.
 *
 * Grid cards only show a line or two, so this favours readable text over a
 * faithful markdown render: block markers (headings, list bullets,
 * blockquotes, horizontal rules), inline emphasis, links/images, inline code,
 * HTML tags and comments are stripped, and whitespace is collapsed to single
 * spaces. Backslash escapes are shown as the literal character. Only a
 * short prefix is processed since the preview is clamped.
 */
export function markdownToPlainText(input?: string | null): string {
  if (!input) {
    return "";
  }

  const withoutBlocks = protectEscapes(input.slice(0, MAX_PREVIEW_LENGTH))
    // HTML comments, e.g. <!-- vadivam-icon-count:start -->
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Fenced code block fences and their language hints
    .replace(/^\s*(?:```|~~~).*$/gm, " ")
    // Images: keep the alt text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Inline and reference links: keep the label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    // Any remaining HTML tags
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ");

  const lines = withoutBlocks.split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();

    // Horizontal rules -> drop entirely
    if (/^(?:[-*_]\s*){3,}$/.test(line)) {
      return "";
    }

    return (
      line
        // Leading heading markers (#, ##, ...)
        .replace(/^#{1,6}\s+/, "")
        // Leading blockquote markers, possibly nested
        .replace(/^(?:>\s?)+/, "")
        // Task list checkboxes
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
        // Unordered list bullets
        .replace(/^[-*+]\s+/, "")
        // Ordered list markers (1. or 1))
        .replace(/^\d+[.)]\s+/, "")
    );
  });

  return restoreEscapes(
    lines
      .join(" ")
      // Inline code -> keep the contents
      .replace(/`([^`]+)`/g, "$1")
      // Bold / italic / strikethrough (paired markers)
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
      // Mid-line heading runs left over from single-line markdown, e.g.
      // "AGENTS.md ## Project Overview" -> "AGENTS.md Project Overview"
      .replace(/\s+#{1,6}\s+/g, " ")
      // Collapse remaining whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}
