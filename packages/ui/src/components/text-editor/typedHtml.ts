// The rich editor keeps HTML typed into a note as text: `<b>` saves as
// `&lt;b&gt;`. Its stand-in edits Markdown directly, so it escapes typed tags
// the same way before they reach the note.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
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

/** Escapes a line's tags outside its code spans (a run of backticks up to
 * the next run of the same length), whose text Markdown keeps as it is. */
function escapeLine(line: string): string {
  const runs = [...line.matchAll(BACKTICKS)];
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
      escapeTags(line.slice(last, start.index)) + line.slice(start.index, end);
    last = end;
    open = close;
  }
  return result + escapeTags(line.slice(last));
}

/** Markdown with its HTML tags escaped, outside code spans and fences. */
export function escapeTypedHtml(source: string): string {
  if (!source.includes("<")) {
    return source;
  }
  let fence = "";
  return source
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1] ?? "";
      if (fence) {
        if (marker.startsWith(fence[0]) && marker.length >= fence.length) {
          fence = line.trim() === marker ? "" : fence;
        }
        return line;
      }
      fence = marker;
      return marker ? line : escapeLine(line);
    })
    .join("\n");
}
