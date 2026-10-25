import { isProbablyReaderable, Readability } from "@mozilla/readability";
import {
  ARTICLE_IMAGE_MAX_BYTES,
  ARTICLE_IMAGE_MAX_WIDTH,
  ARTICLE_IMAGES_MAX_TOTAL_BYTES,
  ARTICLE_MAX_IMAGES,
  articleImageToken,
  articlePlainText,
  countWords,
  isArticleLength,
} from "@teak/convex/shared/article";
import { PAGE_ARCHIVE_ROLE } from "@teak/convex/shared/pageArchive";
import {
  FILES_EXTRACTED_TEXT_MAX_CHARACTERS,
  FILES_LINK_PAGE_MAX_URL_LENGTH,
  type FilesArticleImage,
  type FilesExtractArticleParams,
  type FilesExtractArticleResult,
  parseCardObjectKey,
} from "@teak/files-protocol";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { IMAGES_BINDING_MAX_INPUT_BYTES } from "../images/imagesBinding";
import { isValidUploadKey } from "../storage/upload";
import { resolveHttpUrl } from "./css";
import { createRewriter, htmlResponse } from "./html";

/**
 * Re-encodes an article image as WebP, at most 1600 px wide; null leaves it
 * out. The Files Worker's IMAGES binding, or a stand-in in tests.
 */
export type EncodeArticleImage = (image: {
  body: Uint8Array;
  contentType: string;
}) => Promise<Uint8Array | null>;

export interface ExtractArticleOptions {
  encodeImage?: EncodeArticleImage;
  /** The longest Markdown kept; past it the article is cut and `truncated`. */
  maxMarkdownChars?: number;
}

/** The archive's images, before Readability picks the article's own. */
const CANDIDATE_SCHEME = "teak-candidate:";
/** The archive inlines at most 200 subresources; this is a safety net. */
const MAX_CANDIDATES = 400;
const RASTER_DATA_URI =
  /^data:(image\/(?:png|jpe?g|gif|webp|avif|bmp));base64,/iu;
/**
 * Elements an article never needs, dropped before parsing. A page's own
 * top-level header is navigation, and a text-only copy's says "Text-only
 * copy".
 */
const DROPPED_ELEMENTS =
  "body > header, script, style, link, template, iframe, frame, frameset, object, embed, canvas, video, audio, picture > source, form, button, input, select, textarea, svg, math, dialog";
const SAFE_LINK = /^(?:https?:|mailto:)/iu;
/**
 * A task list's checkboxes, as words made up for this run: form controls go
 * before Readability, and these survive it to become `[x]` and `[ ]`. A
 * random token can't already be in the page, as a fixed character could.
 */
const taskMarks = () => {
  const token = crypto.randomUUID().replaceAll("-", "");
  return {
    done: `teaktask${token}done`,
    open: `teaktask${token}open`,
    pattern: new RegExp(`teaktask${token}(done|open)[ \\t]*`, "gu"),
  };
};
type TaskMarks = ReturnType<typeof taskMarks>;

interface SlimPage {
  candidates: string[];
  dir?: string;
  html: string;
  lang?: string;
  tasks: TaskMarks;
}

/**
 * The archive without what Readability can't use: scripts, styles, media
 * and inline styles go, links become absolute, and each raster `data:` image
 * becomes `teak-candidate:<k>` so the DOM stays small. Other images go: the
 * archive's images are all inlined, so nothing is fetched again.
 */
const slimArchive = async (
  html: string,
  pageUrl: string
): Promise<SlimPage> => {
  const candidates: string[] = [];
  const indexes = new Map<string, number>();
  const tasks = taskMarks();
  const page: SlimPage = { candidates, html: "", tasks };
  const rewritten = await createRewriter()
    .on('li input[type="checkbox"]', {
      element(element) {
        element.replace(
          `${element.hasAttribute("checked") ? tasks.done : tasks.open} `
        );
      },
    })
    .on(DROPPED_ELEMENTS, {
      element(element) {
        if (!element.removed) {
          element.remove();
        }
      },
    })
    .on("html", {
      element(element) {
        const lang = element.getAttribute("lang")?.trim();
        const dir = element.getAttribute("dir")?.trim().toLowerCase();
        if (lang) {
          page.lang = lang;
        }
        if (dir === "rtl" || dir === "ltr") {
          page.dir = dir;
        }
      },
    })
    .on("*", {
      element(element) {
        element.removeAttribute("style");
      },
    })
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href") ?? "";
        if (href.startsWith("#")) {
          element.removeAttribute("href");
          return;
        }
        const absolute =
          resolveHttpUrl(href, pageUrl) ??
          (/^mailto:/iu.test(href.trim()) ? href.trim() : null);
        if (absolute && SAFE_LINK.test(absolute)) {
          element.setAttribute("href", absolute);
        } else {
          element.removeAttribute("href");
        }
      },
    })
    .on("img", {
      element(element) {
        const src = element.getAttribute("src")?.trim() ?? "";
        element.removeAttribute("srcset");
        element.removeAttribute("sizes");
        element.removeAttribute("loading");
        let index = indexes.get(src);
        if (index === undefined) {
          if (
            !RASTER_DATA_URI.test(src) ||
            candidates.length >= MAX_CANDIDATES
          ) {
            element.remove();
            return;
          }
          index = candidates.length;
          indexes.set(src, index);
          candidates.push(src);
        }
        // The same image again is the same candidate, and so the same image.
        element.setAttribute("src", `${CANDIDATE_SCHEME}${index}`);
      },
    })
    .transform(htmlResponse(html))
    .text();
  page.html = rewritten;
  return page;
};

/** The few DOM members this file uses, from linkedom; Workers have no DOM types. */
interface DomNode {
  nextSibling: DomNode | null;
  nodeName: string;
  parentNode: DomElement | null;
  textContent: string | null;
}

interface DomElement extends DomNode {
  children: Iterable<DomElement>;
  closest: (selector: string) => DomElement | null;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  querySelector: (selector: string) => DomElement | null;
  querySelectorAll: (selector: string) => Iterable<DomElement>;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
}

type ReadabilityDocument = ConstructorParameters<typeof Readability>[0];
type TurndownInput = Parameters<TurndownService["turndown"]>[0];

const textOf = (node: DomNode | null | undefined): string =>
  (node?.textContent ?? "").replace(/\s+/gu, " ").trim();

/** A GFM table needs a header row: the first row becomes one. */
const tableRows = (table: DomElement): DomElement[] =>
  [...table.querySelectorAll("tr")].filter(
    (row) => row.closest("table") === table
  );

const cellsOf = (row: DomElement): DomElement[] =>
  [...row.children].filter(
    (cell) => cell.nodeName === "TD" || cell.nodeName === "TH"
  );

const escapeCell = (text: string) => text.replaceAll("|", "\\|");

/**
 * The article element ready for Markdown: captions on their images, at most
 * 20 distinct images in reading order, the rest and every image Readability
 * kept from outside the archive dropped.
 */
const prepareArticle = (article: DomElement): number[] => {
  for (const figure of article.querySelectorAll("figure")) {
    const caption = figure.querySelector("figcaption");
    const image = figure.querySelector("img");
    if (caption && image && !image.getAttribute("title")) {
      const text = textOf(caption);
      if (text) {
        image.setAttribute("title", text);
      }
      caption.remove();
    }
  }
  const kept: number[] = [];
  for (const image of article.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const index = src.startsWith(CANDIDATE_SCHEME)
      ? Number(src.slice(CANDIDATE_SCHEME.length))
      : Number.NaN;
    if (!Number.isInteger(index)) {
      image.remove();
      continue;
    }
    if (!kept.includes(index)) {
      if (kept.length >= ARTICLE_MAX_IMAGES) {
        image.remove();
        continue;
      }
      kept.push(index);
    }
  }
  return kept;
};

const escapeTitle = (title: string) =>
  title.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const createTurndown = () => {
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    headingStyle: "atx",
    hr: "---",
    strongDelimiter: "**",
  });
  service.remove(["head", "meta", "noscript", "title"]);
  service.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const element = node as unknown as DomElement;
      const src = element.getAttribute("src") ?? "";
      if (!src.startsWith(CANDIDATE_SCHEME)) {
        return "";
      }
      const alt = (element.getAttribute("alt") ?? "")
        .replace(/\s+/gu, " ")
        .replace(/[[\]]/gu, "")
        .trim();
      const title = element.getAttribute("title")?.replace(/\s+/gu, " ").trim();
      return `![${alt}](${src}${title ? ` "${escapeTitle(title)}"` : ""})`;
    },
  });
  // "- item" and "1. item", indented to match, rather than Turndown's
  // three spaces after the marker.
  service.addRule("listItem", {
    filter: "li",
    replacement: (content, node) => {
      const item = node as unknown as DomElement;
      const parent = item.parentNode;
      let prefix = "- ";
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start"));
        const index = [...parent.children].indexOf(item);
        prefix = `${(Number.isInteger(start) && start > 0 ? start : 1) + index}. `;
      }
      const isParagraph = /\n$/u.test(content);
      const body = `${content.replace(/^\n+|\n+$/gu, "")}${isParagraph ? "\n" : ""}`;
      return `${prefix}${body.replace(/\n/gu, `\n${" ".repeat(prefix.length)}`)}${
        item.nextSibling ? "\n" : ""
      }`;
    },
  });
  service.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: (content) => (content.trim() ? `~~${content}~~` : ""),
  });
  service.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = tableRows(node as unknown as DomElement)
        .map((row) =>
          cellsOf(row).map((cell) => escapeCell(textOf(cell)) || " ")
        )
        .filter((cells) => cells.length > 0);
      const [header, ...body] = rows;
      if (!header) {
        return "";
      }
      const width = Math.max(...rows.map((cells) => cells.length));
      const pad = (cells: string[]) => [
        ...cells,
        ...Array.from({ length: width - cells.length }, () => " "),
      ];
      const line = (cells: string[]) => `| ${pad(cells).join(" | ")} |`;
      return `\n\n${[
        line(header),
        `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
        ...body.map(line),
      ].join("\n")}\n\n`;
    },
  });
  return service;
};

/** Cuts Markdown at the last block boundary that fits. */
const truncateMarkdown = (
  markdown: string,
  maxChars: number
): { markdown: string; truncated: boolean } => {
  if (markdown.length <= maxChars) {
    return { markdown, truncated: false };
  }
  const head = markdown.slice(0, maxChars);
  const boundary = head.lastIndexOf("\n\n");
  const cut = boundary > maxChars / 2 ? head.slice(0, boundary) : head;
  // A cut inside a code fence leaves it open; close it.
  const fences = cut.match(/^\s*```/gmu)?.length ?? 0;
  return {
    markdown: `${cut.trimEnd()}${fences % 2 === 1 ? "\n```" : ""}`,
    truncated: true,
  };
};

const decodeDataUri = (
  uri: string
): { body: Uint8Array; contentType: string } | null => {
  const match = RASTER_DATA_URI.exec(uri);
  if (!match?.[1]) {
    return null;
  }
  try {
    const binary = atob(uri.slice(match[0].length).replace(/\s+/gu, ""));
    const body = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      body[index] = binary.charCodeAt(index);
    }
    return { body, contentType: match[1].toLowerCase() };
  } catch {
    return null;
  }
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

/**
 * Encodes the images the Markdown references, in reading order, and numbers
 * them `teak-image:0…`. An image that can't be encoded, is over 4 MB or
 * past the total budget is taken out of the Markdown.
 */
const settleImages = async (
  markdown: string,
  candidates: string[],
  encodeImage: EncodeArticleImage | undefined
): Promise<{ images: FilesArticleImage[]; markdown: string }> => {
  const order: number[] = [];
  for (const match of markdown.matchAll(/teak-candidate:(\d+)/gu)) {
    const index = Number(match[1]);
    if (!order.includes(index)) {
      order.push(index);
    }
  }
  const images: FilesArticleImage[] = [];
  const numbers = new Map<number, number>();
  let totalBytes = 0;
  for (const index of order) {
    const decoded = decodeDataUri(candidates[index] ?? "");
    const encoded =
      decoded && encodeImage
        ? await encodeImage(decoded).catch(() => null)
        : null;
    if (
      !encoded ||
      encoded.byteLength === 0 ||
      encoded.byteLength > ARTICLE_IMAGE_MAX_BYTES ||
      totalBytes + encoded.byteLength > ARTICLE_IMAGES_MAX_TOTAL_BYTES
    ) {
      continue;
    }
    totalBytes += encoded.byteLength;
    numbers.set(index, images.length);
    images.push({
      base64: toBase64(encoded),
      bytes: encoded.byteLength,
      contentType: "image/webp",
    });
  }
  let settled = markdown;
  for (const index of order) {
    if (!numbers.has(index)) {
      settled = settled.replace(
        new RegExp(
          `!\\[[^\\]]*\\]\\(${CANDIDATE_SCHEME}${index}(?!\\d)(?:\\s+"(?:[^"\\\\]|\\\\.)*")?\\)`,
          "gu"
        ),
        ""
      );
    }
  }
  settled = settled.replace(
    /teak-candidate:(\d+)/gu,
    (_match, index: string) => {
      const number = numbers.get(Number(index));
      return number === undefined ? "" : articleImageToken(number);
    }
  );
  return { images, markdown: settled.replace(/\n{3,}/gu, "\n\n").trim() };
};

const cleanText = (value: string | null | undefined, max = 300) => {
  const text = value?.replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, max) : undefined;
};

const languageTag = (value: string | null | undefined) => {
  const tag = value?.trim();
  return tag && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(tag) ? tag : undefined;
};

interface BodyDocument {
  body:
    | (DomElement & {
        appendChild: (node: DomNode) => void;
        childNodes: Iterable<DomNode>;
        insertBefore: (node: DomNode, before: DomNode | null) => void;
      })
    | null;
  documentElement: { childNodes: Iterable<DomNode> };
}

/**
 * linkedom keeps what a page puts outside `<body>` (a page without the tag,
 * or content after `</body>`) beside it, and Readability walks up to `BODY`
 * and past the document when it finds its article there. That content moves
 * into the body, in reading order: what came before it goes in front of its
 * own content, what came after goes behind.
 */
const moveStrandedIntoBody = (document: BodyDocument) => {
  const { body } = document;
  if (!body) {
    return;
  }
  const first = [...body.childNodes][0] ?? null;
  let seenBody = false;
  for (const node of [...document.documentElement.childNodes]) {
    if (node === body) {
      seenBody = true;
    } else if (node.nodeName !== "HEAD") {
      if (seenBody) {
        body.appendChild(node);
      } else {
        body.insertBefore(node, first);
      }
    }
  }
};

/**
 * The article in a link's saved copy: Readability over the archive, then
 * Markdown with `teak-image:<n>` images. A page without enough text, or one
 * Readability doesn't think is readable and that is short, is `none`.
 */
export const extractArticle = async (
  archiveHtml: string,
  pageUrl: string,
  options: ExtractArticleOptions = {}
): Promise<FilesExtractArticleResult> => {
  const slim = await slimArchive(archiveHtml, pageUrl);
  const { document } = parseHTML(slim.html);
  moveStrandedIntoBody(document as unknown as BodyDocument);
  // Readability reads these for relative links; the archive's are absolute.
  for (const name of ["baseURI", "documentURI"] as const) {
    if (!(document as unknown as Record<string, unknown>)[name]) {
      Object.defineProperty(document, name, { value: pageUrl });
    }
  }
  const readerable = isProbablyReaderable(
    document as unknown as ReadabilityDocument
  );
  const parsed = new Readability<DomElement>(
    document as unknown as ReadabilityDocument,
    {
      charThreshold: 500,
      // Code blocks keep `language-*`; Turndown reads it for the fence.
      keepClasses: true,
      serializer: (node) => node as unknown as DomElement,
    }
  ).parse();
  const content = parsed?.content;
  if (!content) {
    return { kind: "none", reason: "no_content", wordCount: 0 };
  }
  prepareArticle(content);
  const converted = createTurndown()
    .turndown(content as unknown as TurndownInput)
    .replace(slim.tasks.pattern, (_mark, task: string) =>
      task === "done" ? "[x] " : "[ ] "
    )
    .trim();
  const { markdown: cut, truncated } = truncateMarkdown(
    converted,
    options.maxMarkdownChars ?? FILES_EXTRACTED_TEXT_MAX_CHARACTERS
  );
  const wordCount = countWords(articlePlainText(cut));
  if (!isArticleLength(wordCount, readerable)) {
    return {
      kind: "none",
      reason: readerable ? "too_short" : "not_readerable",
      wordCount,
    };
  }
  const { images, markdown } = await settleImages(
    cut,
    slim.candidates,
    options.encodeImage
  );
  const dir = (parsed?.dir ?? slim.dir)?.toLowerCase();
  const title = cleanText(parsed?.title);
  const byline = cleanText(parsed?.byline, 200);
  const lang = languageTag(parsed?.lang ?? slim.lang);
  return {
    images,
    kind: "article",
    markdown,
    truncated,
    wordCount,
    ...(title ? { title } : {}),
    ...(byline ? { byline } : {}),
    ...(lang ? { lang } : {}),
    ...(dir === "rtl" || dir === "ltr" ? { dir } : {}),
  };
};

/** The IMAGES binding as an article image encoder: WebP, at most 1600 px. */
export const imagesBindingEncoder = (
  images: ImagesBinding | undefined
): EncodeArticleImage | undefined =>
  images
    ? async ({ body }) => {
        if (body.byteLength > IMAGES_BINDING_MAX_INPUT_BYTES) {
          return null;
        }
        const result = await images
          .input(new Response(body).body as ReadableStream)
          .transform({ fit: "scale-down", width: ARTICLE_IMAGE_MAX_WIDTH })
          .output({ format: "image/webp", quality: 82 });
        return new Uint8Array(await result.response().arrayBuffer());
      }
    : undefined;

export const parseExtractArticleParams = (
  params: Record<string, unknown>
): FilesExtractArticleParams => {
  const { archiveKey, pageUrl } = params;
  if (
    typeof archiveKey !== "string" ||
    !isValidUploadKey(archiveKey) ||
    parseCardObjectKey(archiveKey).role !== PAGE_ARCHIVE_ROLE
  ) {
    throw new Error("invalid_storage_key");
  }
  if (
    typeof pageUrl !== "string" ||
    pageUrl.length > FILES_LINK_PAGE_MAX_URL_LENGTH ||
    !resolveHttpUrl(pageUrl, pageUrl)
  ) {
    throw new Error("invalid_extract_article_params");
  }
  return { archiveKey, pageUrl };
};

/**
 * `extract-article`: reads the saved copy and returns its article. It
 * writes nothing; the workflow step stores what it returns.
 */
export const runExtractArticle = async (
  env: { BUCKET: R2Bucket; IMAGES?: ImagesBinding },
  params: FilesExtractArticleParams,
  options: Omit<ExtractArticleOptions, "encodeImage"> = {}
): Promise<FilesExtractArticleResult> => {
  const object = await env.BUCKET.get(params.archiveKey);
  if (!object) {
    return { kind: "missing" };
  }
  const html = await object.text();
  return await extractArticle(html, params.pageUrl, {
    ...options,
    ...(env.IMAGES ? { encodeImage: imagesBindingEncoder(env.IMAGES) } : {}),
  });
};
