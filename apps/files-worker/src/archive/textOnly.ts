import { resolveHttpUrl } from "./css";
import {
  atEndTag,
  byteLength,
  createRewriter,
  decodeHtmlText,
  escapeHtmlAttribute,
  escapeHtmlText,
  htmlResponse,
} from "./html";

/** The facts about a page a text-only copy keeps. */
export interface TextOnlyPage {
  baseUrl: string;
  dir?: string;
  lang?: string;
  title: string;
}

const TEXT_BLOCKS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "blockquote",
  "pre",
]);
/** Containers whose loose text becomes a paragraph of its own. */
const PARAGRAPH_LIKE = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "td",
  "th",
  "dd",
  "dt",
  "figcaption",
  "summary",
  "caption",
]);
const SKIPPED_TEXT =
  "title, style, script, template, svg, select, noscript, textarea";

interface TextRun {
  href?: string;
  text: string;
}

interface TextBlock {
  runs: TextRun[];
  tag: string;
}

/** A readable stylesheet for text-only copies; it needs nothing fetched. */
const TEXT_ONLY_STYLE =
  "body{max-width:42rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif;color:#1a1a1a;background:#fff}header{color:#666;font-size:.875rem;border-bottom:1px solid #e5e5e5;margin-bottom:1.5rem}pre{white-space:pre-wrap}a{color:#0b57d0}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:1rem;color:#444}";

/**
 * The page's title and body text as a minimal document: headings,
 * paragraphs, list items, quotes, preformatted text and links, under a
 * "Text-only copy" heading.
 */
export const buildTextOnlyDocument = async (
  html: string,
  page: TextOnlyPage,
  header: string,
  budgetBytes: number
): Promise<string> => {
  const blocks: TextBlock[] = [];
  let current: TextBlock = { runs: [], tag: "p" };
  let link: string | undefined;
  let skipDepth = 0;
  const flush = (nextTag = "p") => {
    const text = current.runs
      .map((run) => run.text)
      .join("")
      .trim();
    if (text) {
      blocks.push(current);
    }
    current = { runs: [], tag: nextTag };
  };
  await createRewriter()
    .on(SKIPPED_TEXT, {
      element(element) {
        skipDepth += 1;
        atEndTag(element, () => {
          skipDepth = Math.max(0, skipDepth - 1);
        });
      },
    })
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (TEXT_BLOCKS.has(tag) || PARAGRAPH_LIKE.has(tag) || tag === "br") {
          if (tag === "br") {
            current.runs.push({ text: "\n" });
            return;
          }
          flush(TEXT_BLOCKS.has(tag) ? tag : "p");
          atEndTag(element, () => flush("p"));
        }
      },
    })
    .on("a[href]", {
      element(element) {
        const resolved = resolveHttpUrl(
          element.getAttribute("href") ?? "",
          page.baseUrl
        );
        link = resolved ?? undefined;
        atEndTag(element, () => {
          link = undefined;
        });
      },
    })
    // The whole document's text, so a page without a <body> tag keeps its
    // words; the title and other head text are skipped above.
    .onDocument({
      text(text) {
        if (skipDepth > 0 || !text.text) {
          return;
        }
        const last = current.runs.at(-1);
        if (last && last.href === link) {
          last.text += text.text;
        } else {
          current.runs.push({ href: link, text: text.text });
        }
      },
    })
    .transform(htmlResponse(html))
    .text();
  flush();

  const render = (block: TextBlock) => {
    const inner = block.runs
      .map((run) => {
        const decoded = decodeHtmlText(run.text);
        const text = escapeHtmlText(
          block.tag === "pre" ? decoded : decoded.replace(/\s+/gu, " ")
        );
        return run.href
          ? `<a href="${escapeHtmlAttribute(run.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : text;
      })
      .join("")
      .trim();
    return `<${block.tag} dir="auto">${inner}</${block.tag}>`;
  };
  const htmlAttributes = [
    page.lang ? ` lang="${escapeHtmlAttribute(page.lang)}"` : "",
    page.dir ? ` dir="${escapeHtmlAttribute(page.dir)}"` : "",
  ].join("");
  const title = escapeHtmlText(page.title);
  const opening = `<!doctype html><html${htmlAttributes}><head>${header}<title>${title}</title><style>${TEXT_ONLY_STYLE}</style></head><body><header><p>Text-only copy</p></header>${
    title ? `<h1 dir="auto">${title}</h1>` : ""
  }`;
  const closing = "</body></html>";
  let size = byteLength(opening) + byteLength(closing);
  const parts: string[] = [];
  for (const block of blocks) {
    const rendered = render(block);
    const weight = byteLength(rendered);
    if (size + weight > budgetBytes) {
      break;
    }
    size += weight;
    parts.push(rendered);
  }
  return `${opening}${parts.join("")}${closing}`;
};
