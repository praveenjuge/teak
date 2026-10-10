/**
 * Splits Markdown into the blocks the web's note view shows: headings,
 * lists, quotes, code, and paragraphs. SwiftUI's Text styles inline Markdown
 * on its own but drops block structure, so each block becomes its own view.
 */
export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: MarkdownListItem[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

export interface MarkdownListItem {
  depth: number;
  marker: string;
  text: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

const listItem = (line: string): MarkdownListItem | null => {
  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      depth: Math.floor(bullet[1].length / 2),
      marker: "•",
      text: bullet[2],
    };
  }
  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      depth: Math.floor(ordered[1].length / 2),
      marker: `${ordered[2]}.`,
      text: ordered[3],
    };
  }
  return null;
};

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !lines[index].trim().startsWith(fence[1])
      ) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quote.push(QUOTE.exec(lines[index])?.[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }

    if (listItem(line)) {
      const items: MarkdownListItem[] = [];
      let item = listItem(lines[index] ?? "");
      while (item) {
        items.push(item);
        index += 1;
        item = index < lines.length ? listItem(lines[index]) : null;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !(
        FENCE.test(lines[index]) ||
        HEADING.test(lines[index]) ||
        QUOTE.test(lines[index]) ||
        RULE.test(lines[index]) ||
        listItem(lines[index])
      )
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}
