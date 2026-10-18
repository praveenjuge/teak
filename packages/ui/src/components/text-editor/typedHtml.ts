import { Marked, type Token, type Tokens } from "marked";

const lexer = new Marked({ gfm: true });
const BACKTICKS = /`+/g;
const RAW_HTML_OR_AUTOLINK_START = /<([A-Za-z/!?][^<>\n]*)(>?)/g;

const escapeTags = (text: string) =>
  text.replace(
    RAW_HTML_OR_AUTOLINK_START,
    (_match, inner: string, close: string) =>
      `&lt;${inner}${close ? "&gt;" : ""}`
  );

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

function escapeBlock(block: Token): string {
  if (!holdsCodeBlock(block)) {
    return escapeOutsideCodeSpans(block.raw);
  }
  if (block.type === "list") {
    const { items } = block as Tokens.List;
    const itemsRaw = items.map((item) => item.raw).join("");
    if (block.raw.startsWith(itemsRaw)) {
      return items.map(escapeBlock).join("") + block.raw.slice(itemsRaw.length);
    }
  }
  return block.raw;
}

export function escapeTypedHtml(source: string): string {
  if (!source.includes("<")) {
    return source;
  }
  const blocks = lexer.lexer(source);
  if (blocks.map((block) => block.raw).join("") !== source) {
    return escapeOutsideCodeSpans(source);
  }
  return blocks.map(escapeBlock).join("");
}
