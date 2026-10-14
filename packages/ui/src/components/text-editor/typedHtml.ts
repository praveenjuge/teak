import { Marked, type Token } from "marked";

// The rich editor keeps HTML typed into a note as text: `<b>` saves as
// `&lt;b&gt;`. Its stand-in edits Markdown directly, so it escapes typed tags
// the same way before they reach the note. Code keeps its text as typed:
// Markdown shows an entity in code literally.

const lexer = new Marked({ gfm: true });
const BACKTICKS = /`+/g;
// What Markdown could read as raw HTML (a tag, comment or declaration) or
// as an autolink: `<` and a letter, `/`, `!` or `?`, up to the next `>`.
const TAG = /<([A-Za-z/!?][^<>\n]*)(>?)/g;

const escapeTags = (text: string) =>
  text.replace(
    TAG,
    (_match, inner: string, close: string) =>
      `&lt;${inner}${close ? "&gt;" : ""}`
  );

/** Escapes the tags outside code spans (a run of backticks up to the next
 * run of the same length). */
function escapeOutsideCodeSpans(text: string): string {
  const runs = [...text.matchAll(BACKTICKS)];
  let result = "";
  let last = 0;
  for (let open = 0; open < runs.length; open++) {
    const start = runs[open];
    const close = runs.findIndex(
      (run, index) => index > open && run[0].length === start[0].length
    );
    if (close === -1) {
      continue;
    }
    const end = runs[close].index + runs[close][0].length;
    result +=
      escapeTags(text.slice(last, start.index)) + text.slice(start.index, end);
    last = end;
    open = close;
  }
  return result + escapeTags(text.slice(last));
}

function holdsCodeBlock(token: Token): boolean {
  let found = token.type === "code";
  lexer.walkTokens([token], (child) => {
    found ||= child.type === "code";
  });
  return found;
}

/** Markdown with its HTML tags escaped, outside code. */
export function escapeTypedHtml(source: string): string {
  if (!source.includes("<")) {
    return source;
  }
  // Top-level blocks, which together are the whole source. A fenced or
  // indented code block, or a list or quote holding one, keeps its text.
  const blocks = lexer.lexer(source);
  if (blocks.map((block) => block.raw).join("") !== source) {
    return escapeOutsideCodeSpans(source);
  }
  return blocks
    .map((block) =>
      holdsCodeBlock(block) ? block.raw : escapeOutsideCodeSpans(block.raw)
    )
    .join("");
}
