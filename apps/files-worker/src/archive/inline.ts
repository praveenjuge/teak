import {
  cssImports,
  cssUrlRefs,
  decodeCssText,
  escapeStyleText,
  resolveHttpUrl,
  rewriteCssUrls,
  selectFontSources,
  stripCharsetRule,
  stripCssImports,
  wrapImportedCss,
} from "./css";
import {
  atEndTag,
  byteLength,
  createRewriter,
  decodeHtmlText,
  escapeHtmlAttribute,
  htmlResponse,
} from "./html";
import { buildTextOnlyDocument } from "./textOnly";

/**
 * A page archive: one self-contained HTML file with no scripts, its CSS,
 * fonts and images inlined as `data:` URIs, within a size budget. Teak's own
 * code, on `HTMLRewriter`; every subresource is fetched through the callers'
 * SSRF-checked fetchers, never with a bare `fetch`.
 */

const MIB = 1024 * 1024;

/** The most a whole archive may weigh, in bytes of UTF-8. */
export const PAGE_ARCHIVE_BUDGET_BYTES = 20 * MIB;
/** Subresource requests per archive, across CSS, fonts and images. */
export const PAGE_ARCHIVE_MAX_REQUESTS = 200;
/** Fetched bytes per archive, across CSS, fonts and images. */
export const PAGE_ARCHIVE_MAX_INPUT_BYTES = 60 * MIB;
/** Stylesheets per archive, `@import`s included. */
export const PAGE_ARCHIVE_MAX_STYLESHEETS = 40;
/** The most one stylesheet or font may weigh (a fetcher hop's limit). */
export const PAGE_ARCHIVE_MAX_TEXT_BYTES = 4 * MIB;
/** Images wider than this are re-encoded to this width. */
export const PAGE_ARCHIVE_IMAGE_WIDTH = 1600;
/** Subresources fetched at once. */
const FETCH_CONCURRENCY = 4;

/**
 * The archive's own policy: nothing loads from the network and no script
 * runs, wherever the file is opened.
 */
export const PAGE_ARCHIVE_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'";

/**
 * The header a stored archive is served with: wherever it opens, someone
 * else's HTML runs in an opaque origin with no scripts and loads nothing.
 * Its links open in a new tab outside the sandbox; a frame's own `sandbox`
 * can't loosen this header, so the popup tokens live here too.
 */
export const PAGE_ARCHIVE_CONTENT_SECURITY_POLICY =
  "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:";

export type PageArchiveKind = "full" | "text_only";
export type PageArchiveSource = "extension" | "server";

export interface FetchedAsset {
  body: Uint8Array;
  contentType: string;
  /** Where the request ended up after redirects, when it moved. */
  finalUrl?: string;
  height?: number;
  width?: number;
}

export interface PageArchiveDeps {
  /** An image (through the fetcher's `/fetch`) or a font (through `/hop`). */
  fetchAsset: (
    url: string,
    kind: "font" | "image"
  ) => Promise<FetchedAsset | null>;
  /** A stylesheet's bytes, through `/hop`; at most 4 MiB. */
  fetchText: (url: string) => Promise<FetchedAsset | null>;
  /** Re-encodes an image to `width` pixels wide WebP, or null to keep it. */
  images?: {
    resize: (
      asset: FetchedAsset,
      width: number
    ) => Promise<FetchedAsset | null>;
  };
}

export interface BuildPageArchiveInput extends PageArchiveDeps {
  budgetBytes?: number;
  capturedAt: number;
  /** Fetches still running at this time (epoch ms) are dropped. */
  deadline?: number;
  html: string;
  maxInputBytes?: number;
  maxRequests?: number;
  pageUrl: string;
  source: PageArchiveSource;
}

export interface PageArchive {
  /** The page's address: its `<base href>`, or `pageUrl`. */
  baseUrl: string;
  bytes: number;
  /** Images and fonts left out to fit the budget or the input limits. */
  dropped: number;
  html: string;
  /** Images and fonts carried inside the file. */
  inlined: number;
  kind: PageArchiveKind;
}

const archiveHeader = (input: {
  capturedAt: number;
  pageUrl: string;
  source: PageArchiveSource;
}) =>
  [
    '<meta charset="utf-8">',
    `<meta name="teak-archive" content="${escapeHtmlAttribute(
      JSON.stringify({
        url: input.pageUrl,
        capturedAt: input.capturedAt,
        source: input.source,
      })
    )}">`,
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_ARCHIVE_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
  ].join("");

// The page's own charset declarations go before HTMLRewriter reads it: the
// text is already decoded, and the archive is always UTF-8.
const CHARSET_META =
  /<meta\b[^>]*(?:\bcharset\s*=|http-equiv\s*=\s*["']?content-type)[^>]*>/giu;

const stripCharsetMeta = (html: string) => html.replace(CHARSET_META, "");

/** `<noscript>` content becomes ordinary markup, which the next pass sees. */
const unwrapNoscript = (html: string) =>
  createRewriter()
    .on("noscript", {
      element(element) {
        element.removeAndKeepContent();
      },
    })
    .transform(htmlResponse(html))
    .text();

/** Elements an archive never carries, with their content. */
const REMOVED_ELEMENTS = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "video",
  "audio",
  "source",
  "track",
  "portal",
  "template",
  "base",
  "link",
  "meta[http-equiv]",
].join(", ");

/** Attributes whose value can be a URL a browser acts on. */
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "codebase",
  "data",
  "formaction",
  "href",
  "longdesc",
  "lowsrc",
  "manifest",
  "poster",
  "src",
  "xlink:href",
]);

/** Attributes that only ever load or report something. */
const ALWAYS_REMOVED_ATTRIBUTES = new Set([
  "ping",
  "srcdoc",
  "integrity",
  "nonce",
]);

const isScriptUrl = (value: string): boolean => {
  // Browsers ignore whitespace and control characters inside the scheme.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers strip them from schemes
  const compact = value.replace(/[\u0000- ]/gu, "").toLowerCase();
  return (
    compact.startsWith("javascript:") ||
    compact.startsWith("vbscript:") ||
    (compact.startsWith("data:") && !compact.startsWith("data:image/"))
  );
};

const scrubAttributes = (element: Element) => {
  for (const [name, value] of [...element.attributes]) {
    const lower = name.toLowerCase();
    if (
      lower.startsWith("on") ||
      ALWAYS_REMOVED_ATTRIBUTES.has(lower) ||
      (URL_ATTRIBUTES.has(lower) && isScriptUrl(value))
    ) {
      element.removeAttribute(name);
    }
  }
};

interface ImageCandidate {
  url: string;
  width?: number;
}

const parseSrcset = (srcset: string, base: string): ImageCandidate[] =>
  srcset
    .split(/,(?=\s*\S)/u)
    .map((entry) => entry.trim().split(/\s+/u))
    .flatMap(([url, descriptor]): ImageCandidate[] => {
      const resolved = url ? resolveHttpUrl(url, base) : null;
      if (!resolved) {
        return [];
      }
      const widthMatch = /^(\d+)w$/iu.exec(descriptor ?? "");
      if (widthMatch) {
        return [{ url: resolved, width: Number(widthMatch[1]) }];
      }
      const densityMatch = /^(\d+(?:\.\d+)?)x$/iu.exec(descriptor ?? "1x");
      return [
        {
          url: resolved,
          width: densityMatch
            ? Math.round(Number(densityMatch[1]) * 800)
            : undefined,
        },
      ];
    });

/**
 * One image from `srcset`, `src` or a lazy-loading attribute: the widest
 * at or under 1600 pixels, else the narrowest. Density descriptors count as
 * 800 pixels per `x`, so 2x is the largest picked.
 */
export const pickImageCandidate = (
  attributes: {
    dataSrc?: string | null;
    dataSrcset?: string | null;
    src?: string | null;
    srcset?: string | null;
  },
  base: string
): string | null => {
  const candidates = [
    ...parseSrcset(attributes.srcset ?? "", base),
    ...parseSrcset(attributes.dataSrcset ?? "", base),
  ];
  const sized = candidates.filter((candidate) => candidate.width);
  const fitting = sized
    .filter((candidate) => (candidate.width ?? 0) <= PAGE_ARCHIVE_IMAGE_WIDTH)
    .sort((left, right) => (right.width ?? 0) - (left.width ?? 0));
  if (fitting[0]) {
    return fitting[0].url;
  }
  const smallest = [...sized].sort(
    (left, right) => (left.width ?? 0) - (right.width ?? 0)
  )[0];
  if (smallest) {
    return smallest.url;
  }
  for (const value of [attributes.dataSrc, attributes.src]) {
    const resolved = value ? resolveHttpUrl(value, base) : null;
    if (resolved) {
      return resolved;
    }
  }
  return candidates[0]?.url ?? null;
};

const isInlineImage = (value: string | null) =>
  Boolean(value && /^\s*data:image\//iu.test(value));

interface CollectedPage {
  baseUrl: string;
  dir?: string;
  /**
   * The page with each `<img>`, `<style>` and `style` attribute numbered
   * (`data-teak-*`), so the rewrite finds what was collected for it even when
   * an element around it is removed.
   */
  html: string;
  /** Per numbered `<img>`: a URL to fetch, or null. */
  images: Array<string | null>;
  lang?: string;
  /** Per numbered element: its `style` attribute. */
  styleAttributes: string[];
  /** Per numbered `<style>`: its CSS. */
  styleBlocks: string[];
  /** Absolute stylesheet URLs, in document order. */
  stylesheets: string[];
  title: string;
}

const IMAGE_MARK = "data-teak-img";
const STYLE_MARK = "data-teak-style";
const STYLE_ATTRIBUTE_MARK = "data-teak-sattr";

const isStylesheetLink = (element: Element) =>
  (element.getAttribute("rel") ?? "")
    .toLowerCase()
    .split(/\s+/u)
    .includes("stylesheet") &&
  !(element.getAttribute("rel") ?? "").toLowerCase().includes("alternate");

const collectPage = async (
  html: string,
  pageUrl: string
): Promise<CollectedPage> => {
  const page: CollectedPage = {
    baseUrl: pageUrl,
    html: "",
    images: [],
    styleAttributes: [],
    styleBlocks: [],
    stylesheets: [],
    title: "",
  };
  let sawBase = false;
  let pictureSources: string[] = [];
  let inPicture = false;
  const linkHrefs: string[] = [];
  let styleText = "";
  const marked = await createRewriter()
    .on("html", {
      element(element) {
        page.lang = element.getAttribute("lang") ?? undefined;
        page.dir = element.getAttribute("dir") ?? undefined;
      },
    })
    .on("base[href]", {
      element(element) {
        if (sawBase) {
          return;
        }
        sawBase = true;
        const resolved = resolveHttpUrl(
          element.getAttribute("href") ?? "",
          pageUrl
        );
        if (resolved) {
          page.baseUrl = resolved;
        }
      },
    })
    .on("title", {
      text(text) {
        page.title += text.text;
      },
    })
    .on("link[href]", {
      element(element) {
        if (isStylesheetLink(element)) {
          linkHrefs.push(element.getAttribute("href") ?? "");
        }
      },
    })
    .on("style", {
      element(element) {
        element.setAttribute(STYLE_MARK, String(page.styleBlocks.length));
        page.styleBlocks.push("");
      },
      text(text) {
        styleText += text.text;
        if (text.lastInTextNode) {
          page.styleBlocks[page.styleBlocks.length - 1] = styleText;
          styleText = "";
        }
      },
    })
    .on("[style]", {
      element(element) {
        element.setAttribute(
          STYLE_ATTRIBUTE_MARK,
          String(page.styleAttributes.length)
        );
        page.styleAttributes.push(element.getAttribute("style") ?? "");
      },
    })
    .on("picture", {
      element(element) {
        inPicture = true;
        pictureSources = [];
        atEndTag(element, () => {
          inPicture = false;
          pictureSources = [];
        });
      },
    })
    .on("picture source[srcset]", {
      element(element) {
        const type = (element.getAttribute("type") ?? "").toLowerCase();
        if (!type || /^image\/(?:avif|webp|jpeg|png|gif)$/u.test(type)) {
          pictureSources.push(element.getAttribute("srcset") ?? "");
        }
      },
    })
    .on("img", {
      element(element) {
        element.setAttribute(IMAGE_MARK, String(page.images.length));
        const src = element.getAttribute("src");
        const srcset =
          element.getAttribute("srcset") ??
          (inPicture ? (pictureSources[0] ?? null) : null);
        page.images.push(
          isInlineImage(src)
            ? null
            : pickImageCandidate(
                {
                  dataSrc:
                    element.getAttribute("data-src") ??
                    element.getAttribute("data-lazy-src") ??
                    element.getAttribute("data-original"),
                  dataSrcset: element.getAttribute("data-srcset"),
                  src,
                  srcset,
                },
                page.baseUrl
              )
        );
      },
    })
    .transform(htmlResponse(html))
    .text();
  page.html = marked;
  // Relative URLs follow `<base href>`, which the archive itself drops.
  page.stylesheets = linkHrefs
    .map((href) => resolveHttpUrl(href, page.baseUrl))
    .filter((url): url is string => url !== null);
  page.title = decodeHtmlText(page.title).replace(/\s+/gu, " ").trim();
  return page;
};

/** Counts requests and bytes against the archive's input limits. */
class InputBudget {
  private bytes = 0;
  private requests = 0;
  private readonly maxBytes: number;
  private readonly maxRequests: number;
  private readonly deadline: number;

  constructor(maxRequests: number, maxBytes: number, deadline: number) {
    this.maxRequests = maxRequests;
    this.maxBytes = maxBytes;
    this.deadline = deadline;
  }

  take(): boolean {
    if (
      this.requests >= this.maxRequests ||
      this.bytes >= this.maxBytes ||
      Date.now() >= this.deadline
    ) {
      return false;
    }
    this.requests += 1;
    return true;
  }

  spend(bytes: number): boolean {
    this.bytes += bytes;
    return this.bytes <= this.maxBytes;
  }
}

const runPool = async <T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
) => {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next] as T;
        next += 1;
        await work(item);
      }
    }
  );
  await Promise.all(workers);
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const dataUri = (asset: FetchedAsset) =>
  `data:${asset.contentType.split(";")[0]?.trim() || "application/octet-stream"};base64,${toBase64(asset.body)}`;

interface InlineAsset {
  dataUri: string;
  kind: "font" | "image";
  /** How many times the archive repeats it. */
  references: number;
}

/** A light box standing in for an image the archive left out. */
const DROPPED_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1' preserveAspectRatio='none'%3E%3Crect width='1' height='1' fill='%23ececec'/%3E%3C/svg%3E";

interface RenderPlan {
  /** Asset URLs carried in the file. */
  kept: ReadonlySet<string>;
}

interface PageStylesheets {
  /** Per numbered `<style>`. */
  blocks: string[];
  /** Per stylesheet URL; empty when it couldn't be fetched. */
  linked: Map<string, string>;
}

const absolutizeCss = (css: string, base: string) =>
  rewriteCssUrls(selectFontSources(css), base, ({ url }) => url);

/**
 * Fetches the page's stylesheets and resolves their `@import`s (and those of
 * its `<style>` blocks) one level deep, then makes every reference absolute
 * and keeps one source per font face.
 */
const loadStylesheets = async (
  page: CollectedPage,
  budget: InputBudget,
  deps: PageArchiveDeps
): Promise<PageStylesheets> => {
  let count = 0;
  const fetchSheet = async (url: string): Promise<FetchedSheet | null> => {
    if (count >= PAGE_ARCHIVE_MAX_STYLESHEETS || !budget.take()) {
      return null;
    }
    count += 1;
    try {
      const fetched = await deps.fetchText(url);
      if (
        !fetched ||
        fetched.body.byteLength > PAGE_ARCHIVE_MAX_TEXT_BYTES ||
        !budget.spend(fetched.body.byteLength)
      ) {
        return null;
      }
      return {
        css: stripCharsetRule(decodeCssText(fetched.body, fetched.contentType)),
        // A sheet's own references are relative to where it was served from.
        url: fetched.finalUrl ?? url,
      };
    } catch {
      return null;
    }
  };
  const linked = new Map<string, string>();
  for (const url of page.stylesheets) {
    if (linked.has(url)) {
      continue;
    }
    const sheet = await fetchSheet(url);
    linked.set(
      url,
      sheet === null
        ? ""
        : absolutizeCss(
            await resolveImports(sheet.css, sheet.url, fetchSheet),
            sheet.url
          )
    );
  }
  const blocks: string[] = [];
  for (const css of page.styleBlocks) {
    blocks.push(
      absolutizeCss(
        await resolveImports(css, page.baseUrl, fetchSheet),
        page.baseUrl
      )
    );
  }
  return { blocks, linked };
};

/**
 * Replaces each `@import` with the imported stylesheet, one level deep: the
 * imported sheet's own imports are dropped, so a loop ends at once. The
 * import's media, `supports()` and `layer` conditions wrap what it brings in.
 */
interface FetchedSheet {
  css: string;
  /** The URL it was served from, after redirects. */
  url: string;
}

const resolveImports = async (
  css: string,
  base: string,
  fetchSheet: (url: string) => Promise<FetchedSheet | null>
): Promise<string> => {
  let resolved = css;
  for (const { conditions, rule, url } of cssImports(css, base)) {
    const imported = url ? await fetchSheet(url) : null;
    const inlined = imported
      ? wrapImportedCss(
          rewriteCssUrls(
            stripCssImports(imported.css),
            imported.url,
            ({ url: ref }) => ref
          ),
          conditions
        )
      : null;
    resolved = resolved.replace(rule, () => inlined ?? "");
  }
  return resolved;
};

const rewriteForPlan = (
  css: string,
  base: string,
  assets: Map<string, InlineAsset>,
  plan: RenderPlan
) =>
  rewriteCssUrls(css, base, ({ url }) =>
    plan.kept.has(url) ? (assets.get(url)?.dataUri ?? null) : null
  );

const markIndex = (element: Element, name: string): number | null => {
  const value = element.getAttribute(name);
  element.removeAttribute(name);
  const index = Number(value);
  return value !== null && Number.isSafeInteger(index) ? index : null;
};

const DOCTYPE = /^\s*<!doctype[^>]*>/iu;

const renderFull = async (
  page: CollectedPage,
  stylesheets: PageStylesheets,
  assets: Map<string, InlineAsset>,
  plan: RenderPlan,
  header: string
): Promise<string> => {
  let styleBlock: number | null = null;
  let styleText = "";
  let wroteHeader = false;
  const output = await createRewriter()
    .on(REMOVED_ELEMENTS, {
      element(element) {
        if (element.tagName === "link" && isStylesheetLink(element)) {
          const url = resolveHttpUrl(
            element.getAttribute("href") ?? "",
            page.baseUrl
          );
          const css = url ? stylesheets.linked.get(url) : undefined;
          if (url && css) {
            const media = element.getAttribute("media");
            element.replace(
              `<style${
                media ? ` media="${escapeHtmlAttribute(media)}"` : ""
              }>${escapeStyleText(rewriteForPlan(css, url, assets, plan))}</style>`,
              { html: true }
            );
            return;
          }
        }
        element.remove();
      },
    })
    .on("*", {
      element(element) {
        scrubAttributes(element);
      },
    })
    .on("html", {
      element(element) {
        wroteHeader = true;
        element.prepend(header, { html: true });
      },
    })
    .on("a[href], area[href]", {
      element(element) {
        const href = (element.getAttribute("href") ?? "").trim();
        if (href.startsWith("#")) {
          element.removeAttribute("target");
          return;
        }
        const resolved = resolveHttpUrl(href, page.baseUrl);
        if (!resolved) {
          element.removeAttribute("href");
          return;
        }
        element.setAttribute("href", resolved);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      },
    })
    .on("form", {
      element(element) {
        for (const name of ["action", "method", "target"]) {
          element.removeAttribute(name);
        }
        element.setAttribute("data-teak-inert", "");
      },
    })
    .on("[formaction], [formtarget], [formmethod]", {
      element(element) {
        for (const name of ["formaction", "formtarget", "formmethod"]) {
          element.removeAttribute(name);
        }
      },
    })
    .on("style", {
      element(element) {
        styleBlock = markIndex(element, STYLE_MARK);
        styleText = "";
      },
      text(text) {
        styleText += text.text;
        if (!text.lastInTextNode) {
          text.remove();
          return;
        }
        const block =
          styleBlock === null ? undefined : stylesheets.blocks[styleBlock];
        const css =
          block === undefined
            ? styleText
            : rewriteForPlan(block, page.baseUrl, assets, plan);
        styleText = "";
        text.replace(escapeStyleText(css), { html: true });
      },
    })
    .on(`[${STYLE_ATTRIBUTE_MARK}]`, {
      element(element) {
        const index = markIndex(element, STYLE_ATTRIBUTE_MARK);
        const value =
          (index === null ? undefined : page.styleAttributes[index]) ??
          element.getAttribute("style") ??
          "";
        element.setAttribute(
          "style",
          rewriteForPlan(
            absolutizeCss(value, page.baseUrl),
            page.baseUrl,
            assets,
            plan
          )
        );
      },
    })
    .on("img", {
      element(element) {
        const index = markIndex(element, IMAGE_MARK);
        const url = index === null ? null : (page.images[index] ?? null);
        for (const name of [
          "srcset",
          "sizes",
          "data-src",
          "data-srcset",
          "data-lazy-src",
          "data-original",
          "loading",
        ]) {
          element.removeAttribute(name);
        }
        const src = element.getAttribute("src");
        if (url === null && isInlineImage(src)) {
          return;
        }
        const asset = url ? assets.get(url) : undefined;
        if (url && asset && plan.kept.has(url)) {
          element.setAttribute("src", asset.dataUri);
          return;
        }
        element.setAttribute("src", DROPPED_IMAGE);
        element.setAttribute("data-teak-dropped", "");
      },
    })
    .transform(htmlResponse(page.html))
    .text();
  if (wroteHeader) {
    return output;
  }
  const doctype = DOCTYPE.exec(output)?.[0] ?? "";
  return `${doctype}${header}${output.slice(doctype.length)}`;
};

const fetchAssets = async (
  urls: Array<{ kind: "font" | "image"; url: string }>,
  budget: InputBudget,
  deps: PageArchiveDeps,
  assets: Map<string, InlineAsset>
) => {
  const unique = urls.filter(
    (entry, index) =>
      !assets.has(entry.url) &&
      urls.findIndex((other) => other.url === entry.url) === index
  );
  await runPool(unique, FETCH_CONCURRENCY, async ({ kind, url }) => {
    if (!budget.take()) {
      return;
    }
    try {
      let fetched = await deps.fetchAsset(url, kind);
      if (!(fetched && budget.spend(fetched.body.byteLength))) {
        return;
      }
      if (
        kind === "image" &&
        deps.images &&
        (fetched.width ?? 0) > PAGE_ARCHIVE_IMAGE_WIDTH
      ) {
        fetched =
          (await deps.images
            .resize(fetched, PAGE_ARCHIVE_IMAGE_WIDTH)
            .catch(() => null)) ?? fetched;
      }
      assets.set(url, { dataUri: dataUri(fetched), kind, references: 0 });
    } catch {
      // A subresource that fails is left out, like one past the budget.
    }
  });
};

const countReferences = (
  page: CollectedPage,
  stylesheets: PageStylesheets,
  assets: Map<string, InlineAsset>
) => {
  const count = (url: string | null | undefined) => {
    const asset = url ? assets.get(url) : undefined;
    if (asset) {
      asset.references += 1;
    }
  };
  for (const url of page.images) {
    count(url);
  }
  const css = [
    ...stylesheets.blocks.map((text) => ({ base: page.baseUrl, text })),
    ...[...stylesheets.linked].map(([base, text]) => ({ base, text })),
    ...page.styleAttributes.map((text) => ({ base: page.baseUrl, text })),
  ];
  for (const { base, text } of css) {
    for (const ref of cssUrlRefs(text, base)) {
      count(ref.url);
    }
  }
};

const weightOf = (asset: InlineAsset) =>
  asset.dataUri.length * Math.max(1, asset.references);

/** What leaving an asset out saves: its data URIs less their stand-ins. */
const savingOf = (asset: InlineAsset) =>
  Math.max(
    0,
    (asset.dataUri.length -
      (asset.kind === "image" ? DROPPED_IMAGE.length + 24 : 0)) *
      Math.max(1, asset.references)
  );

/**
 * Builds the archive of `html` as saved from `pageUrl`. Images are dropped
 * largest first, then fonts, until the file fits `budgetBytes`; when the HTML
 * and CSS alone don't fit, the archive is text-only.
 */
export const buildPageArchive = async (
  input: BuildPageArchiveInput
): Promise<PageArchive> => {
  const budgetBytes = input.budgetBytes ?? PAGE_ARCHIVE_BUDGET_BYTES;
  const header = archiveHeader(input);
  const html = await unwrapNoscript(stripCharsetMeta(input.html));
  const page = await collectPage(html, input.pageUrl);
  const budget = new InputBudget(
    input.maxRequests ?? PAGE_ARCHIVE_MAX_REQUESTS,
    input.maxInputBytes ?? PAGE_ARCHIVE_MAX_INPUT_BYTES,
    input.deadline ?? Number.POSITIVE_INFINITY
  );

  const stylesheets = await loadStylesheets(page, budget, input);

  const cssRefs = [
    ...stylesheets.blocks.flatMap((css) => cssUrlRefs(css, page.baseUrl)),
    ...[...stylesheets.linked].flatMap(([url, css]) => cssUrlRefs(css, url)),
    ...page.styleAttributes.flatMap((style) => cssUrlRefs(style, page.baseUrl)),
  ];
  const assets = new Map<string, InlineAsset>();
  // Page images first, then fonts, then CSS backgrounds: what the budget
  // reaches first is what the reader misses most.
  await fetchAssets(
    page.images
      .filter((url): url is string => url !== null)
      .map((url) => ({ kind: "image" as const, url })),
    budget,
    input,
    assets
  );
  await fetchAssets(
    cssRefs.filter((ref) => ref.kind === "font"),
    budget,
    input,
    assets
  );
  await fetchAssets(
    cssRefs.filter((ref) => ref.kind === "image"),
    budget,
    input,
    assets
  );
  countReferences(page, stylesheets, assets);

  const render = (kept: ReadonlySet<string>) =>
    renderFull(page, stylesheets, assets, { kept }, header);

  const full = (html: string, bytes: number, kept: number): PageArchive => ({
    baseUrl: page.baseUrl,
    bytes,
    dropped: assets.size - kept,
    html,
    inlined: kept,
    kind: "full",
  });
  const textOnly = async (): Promise<PageArchive> => {
    const document = await buildTextOnlyDocument(
      page.html,
      page,
      header,
      budgetBytes
    );
    return {
      baseUrl: page.baseUrl,
      bytes: byteLength(document),
      dropped: assets.size,
      html: document,
      inlined: 0,
      kind: "text_only",
    };
  };

  const whole = await render(new Set(assets.keys()));
  const wholeBytes = byteLength(whole);
  if (wholeBytes <= budgetBytes) {
    return full(whole, wholeBytes, assets.size);
  }
  if (byteLength(await render(new Set())) > budgetBytes) {
    return await textOnly();
  }

  const byWeight = (kind: "font" | "image") =>
    [...assets]
      .filter(([, asset]) => asset.kind === kind)
      .sort(([, left], [, right]) => weightOf(right) - weightOf(left));
  // Images go first, largest first; fonts only when that isn't enough.
  const dropOrder = [...byWeight("image"), ...byWeight("font")];
  const kept = new Set(assets.keys());
  let estimate = wholeBytes;
  let dropIndex = 0;
  while (estimate > budgetBytes && dropIndex < dropOrder.length) {
    const [url, asset] = dropOrder[dropIndex] as [string, InlineAsset];
    kept.delete(url);
    estimate -= savingOf(asset);
    dropIndex += 1;
  }
  // The estimate leans low on what a drop saves; the render is the truth.
  for (;;) {
    const archive = await render(kept);
    const bytes = byteLength(archive);
    if (bytes <= budgetBytes) {
      return full(archive, bytes, kept.size);
    }
    const next = dropOrder[dropIndex];
    if (!next) {
      return await textOnly();
    }
    kept.delete(next[0]);
    dropIndex += 1;
  }
};
