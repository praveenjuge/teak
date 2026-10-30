/**
 * The small amount of CSS reading a page archive needs: the `url()`s a
 * stylesheet points at, its `@import`s, and one source per `@font-face`.
 * Nothing here parses CSS fully; a rule it misreads keeps its original text,
 * and a reference it can't resolve is dropped by the rewrite.
 */

export type CssUrlKind = "font" | "image";

export interface CssUrlRef {
  kind: CssUrlKind;
  url: string;
}

const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/giu;
const FONT_FACE_PATTERN = /@font-face\s*\{[^}]*\}/giu;
const IMPORT_PATTERN =
  /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)"'\s;]+))\s*\)?([^;]*);?/giu;
const FONT_SRC_PATTERN = /(\bsrc\s*:\s*)([^;}]*)/giu;
const CHARSET_RULE = /^\s*@charset\s+["'][^"']*["']\s*;/iu;

/** An absolute http(s) URL for `value` against `base`, or null. */
export const resolveHttpUrl = (value: string, base: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const urlOf = (match: RegExpExecArray | string[]): string =>
  match[1] ?? match[2] ?? match[3] ?? "";

const fontFaceRanges = (css: string): [number, number][] =>
  Array.from(css.matchAll(FONT_FACE_PATTERN), (match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length,
  ]);

/**
 * Whether `index` falls in one of `ranges`, which are in order and never
 * overlap (they come from one `matchAll`). A binary search: a stylesheet can
 * hold tens of thousands of faces, each with its own `url()`.
 */
const insideAny = (index: number, ranges: [number, number][]) => {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const [start, end] = ranges[middle] as [number, number];
    if (index < start) {
      high = middle - 1;
    } else if (index >= end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
};

/** Splits a declaration value on commas outside parentheses and quotes. */
const splitTopLevel = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

const FONT_FORMAT_ORDER = ["woff2", "woff", "truetype", "opentype"];

const fontSourceRank = (source: string): number => {
  if (!/url\(/iu.test(source)) {
    // `local()` costs nothing and never fetches.
    return -1;
  }
  const format = /format\(\s*["']?([a-z0-9-]+)/iu.exec(source)?.[1];
  const byFormat = format
    ? FONT_FORMAT_ORDER.indexOf(format.toLowerCase())
    : -1;
  if (byFormat >= 0) {
    return byFormat;
  }
  const path = urlOf(
    new RegExp(URL_PATTERN.source, "iu").exec(source) ?? []
  ).toLowerCase();
  const byExtension = [".woff2", ".woff", ".ttf", ".otf"].findIndex((ext) =>
    path.split(/[?#]/u)[0]?.endsWith(ext)
  );
  return byExtension >= 0 ? byExtension : FONT_FORMAT_ORDER.length;
};

/**
 * Keeps one fetched source per `@font-face` (woff2 first, then woff, TrueType
 * and OpenType), beside any `local()` ones, so the archive inlines a single
 * file for each face.
 */
export const selectFontSources = (css: string): string =>
  css.replace(FONT_FACE_PATTERN, (block) =>
    block.replace(FONT_SRC_PATTERN, (_whole, prefix: string, value: string) => {
      const sources = splitTopLevel(value);
      const local = sources.filter((source) => fontSourceRank(source) < 0);
      const remote = sources
        .filter((source) => fontSourceRank(source) >= 0)
        .sort((left, right) => fontSourceRank(left) - fontSourceRank(right));
      const kept = [...local, ...remote.slice(0, 1)];
      return `${prefix}${kept.join(", ")}`;
    })
  );

/** Every `url()` in `css`, resolved against `base`, fonts told from images. */
export const cssUrlRefs = (css: string, base: string): CssUrlRef[] => {
  const fontFaces = fontFaceRanges(css);
  const refs: CssUrlRef[] = [];
  for (const match of css.matchAll(URL_PATTERN)) {
    const raw = urlOf(match);
    if (raw.trim().toLowerCase().startsWith("data:")) {
      continue;
    }
    const url = resolveHttpUrl(raw, base);
    if (url) {
      refs.push({
        kind: insideAny(match.index ?? 0, fontFaces) ? "font" : "image",
        url,
      });
    }
  }
  return refs;
};

/** An inert stand-in for a reference the archive doesn't carry. */
export const EMPTY_CSS_URL = "url(data:,)";

/** Data URIs a stylesheet may keep: images and fonts, never documents. */
const KEPT_DATA_URI = /^data:(?:image\/|font\/|application\/(?:x-)?font)/iu;

const quoteCssUrl = (value: string) =>
  `url("${value.replace(/["\\\n\r]/gu, (char) => `\\${char.charCodeAt(0).toString(16)} `)}")`;

/**
 * Rewrites every `url()` in `css`: `replace` gets the absolute URL and its
 * kind and returns a data URI, or null to drop the reference. Data URIs
 * already in the CSS stay only when they are images or fonts, and references
 * into the page (`url(#id)`) stay as they are.
 */
export const rewriteCssUrls = (
  css: string,
  base: string,
  replace: (ref: CssUrlRef) => string | null
): string => {
  const fontFaces = fontFaceRanges(css);
  return css.replace(
    URL_PATTERN,
    (
      _whole: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      bare: string | undefined,
      index: number
    ) => {
      const raw = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
      if (raw.toLowerCase().startsWith("data:")) {
        return KEPT_DATA_URI.test(raw) ? quoteCssUrl(raw) : EMPTY_CSS_URL;
      }
      // `url(#id)` points into the page itself, like an SVG clip path or
      // gradient, and needs nothing fetched.
      if (raw.startsWith("#")) {
        return quoteCssUrl(raw);
      }
      const url = resolveHttpUrl(raw, base);
      if (!url) {
        return EMPTY_CSS_URL;
      }
      const kind: CssUrlKind = insideAny(index, fontFaces) ? "font" : "image";
      const data = replace({ kind, url });
      return data ? quoteCssUrl(data) : EMPTY_CSS_URL;
    }
  );
};

export interface CssImport {
  /** What follows the URL: `layer`, `supports()` and a media query list. */
  conditions: string;
  /** The whole rule, as it appears in the stylesheet. */
  rule: string;
  url: string;
}

/** The `@import` rules of a stylesheet, resolved against `base`. */
export const cssImports = (css: string, base: string): CssImport[] =>
  Array.from(css.matchAll(IMPORT_PATTERN), (match) => ({
    conditions: (match[4] ?? "").trim(),
    rule: match[0],
    url: resolveHttpUrl(urlOf(match), base) ?? "",
  }));

/** The text inside the parentheses that open `text`, or null. */
const parenthesized = (text: string): string | null => {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(1, index);
      }
    }
  }
  return null;
};

/**
 * An imported stylesheet inside its `@import` conditions, so a print-only
 * or `supports()` import stays conditional once inlined. Null when the
 * conditions can't be read; the import is then dropped.
 */
export const wrapImportedCss = (
  css: string,
  conditions: string
): string | null => {
  if (/[{}]/u.test(conditions)) {
    return null;
  }
  let rest = conditions;
  let layer: string | null = null;
  const layerMatch = /^layer\b/iu.exec(rest);
  if (layerMatch) {
    rest = rest.slice(layerMatch[0].length);
    if (rest.startsWith("(")) {
      const name = parenthesized(rest);
      if (name === null) {
        return null;
      }
      layer = name.trim();
      rest = rest.slice(name.length + 2);
    } else {
      layer = "";
    }
    rest = rest.trim();
  }
  let supports: string | null = null;
  const supportsMatch = /^supports\s*(?=\()/iu.exec(rest);
  if (supportsMatch) {
    rest = rest.slice(supportsMatch[0].length);
    supports = parenthesized(rest);
    if (supports === null) {
      return null;
    }
    rest = rest.slice(supports.length + 2).trim();
  }
  let wrapped = css;
  if (rest) {
    wrapped = `@media ${rest}{${wrapped}}`;
  }
  if (supports !== null) {
    wrapped = `@supports (${supports}){${wrapped}}`;
  }
  if (layer !== null) {
    wrapped = layer ? `@layer ${layer}{${wrapped}}` : `@layer{${wrapped}}`;
  }
  return wrapped;
};

/** Drops every `@import` rule, so a nested import is never followed. */
export const stripCssImports = (css: string): string =>
  css.replace(IMPORT_PATTERN, "");

/** Drops a leading `@charset`, which means nothing inside `<style>`. */
export const stripCharsetRule = (css: string): string =>
  css.replace(CHARSET_RULE, "");

/**
 * Keeps `</style` and the like from ending the `<style>` element the CSS is
 * inlined into.
 */
export const escapeStyleText = (css: string): string =>
  css.replace(/<\/(style)/giu, "<\\/$1").replace(/<!--/gu, "<\\!--");

const charsetFromContentType = (contentType: string): string | null =>
  /charset\s*=\s*"?([^";\s]+)/iu.exec(contentType)?.[1] ?? null;

const charsetFromCss = (bytes: Uint8Array): string | null => {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 128));
  return /^@charset\s+"([^"]+)"/iu.exec(head)?.[1] ?? null;
};

/**
 * A stylesheet's text: its BOM, the Content-Type's charset or its `@charset`
 * picks the encoding, UTF-8 otherwise. An encoding the runtime can't decode
 * falls back to UTF-8.
 */
export const decodeCssText = (
  bytes: Uint8Array,
  contentType: string
): string => {
  const hasUtf8Bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const label = hasUtf8Bom
    ? "utf-8"
    : (charsetFromContentType(contentType) ?? charsetFromCss(bytes) ?? "utf-8");
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
};
