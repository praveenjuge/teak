const MAX_PREVIEW_LENGTH = 500;

/**
 * Convert markdown to plain text for compact card previews.
 *
 * Grid cards only show a line or two, so this favours readable text over a
 * faithful markdown render: block markers (headings, list bullets,
 * blockquotes, horizontal rules), inline emphasis, links/images, inline code,
 * HTML tags and comments are stripped, and whitespace is collapsed to single
 * spaces. Only a short prefix is processed since the preview is clamped.
 */
export function markdownToPlainText(input?: string | null): string {
  if (!input) {
    return "";
  }

  const withoutBlocks = input
    .slice(0, MAX_PREVIEW_LENGTH)
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

  return (
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
