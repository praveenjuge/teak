import { Parser } from "htmlparser2";

const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).byteLength;

export const escapeHtmlAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const escapeHtmlText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * Text as a page shows it: the rewriter hands over text with its character
 * references (`&amp;`, `&#8217;`) still written out.
 */
export const decodeHtmlText = (value: string): string => {
  if (!value.includes("&")) {
    return value;
  }
  let decoded = "";
  const parser = new Parser({
    ontext(text) {
      decoded += text;
    },
  });
  parser.write(value.replaceAll("<", "&lt;"));
  parser.end();
  return decoded;
};

/**
 * An attribute's value as the page means it: the rewriter's `getAttribute`
 * keeps character references as written, so `?a=1&amp;b=2` would otherwise
 * be fetched with a literal `amp;b`.
 */
export const readAttribute = (
  element: Element,
  name: string
): string | null => {
  const value = element.getAttribute(name);
  if (value === null || !value.includes("&")) {
    return value;
  }
  let decoded = value;
  const parser = new Parser({
    onattribute(_name, attribute) {
      decoded = attribute;
    },
  });
  parser.write(`<a v="${value.replaceAll('"', "&quot;")}">`);
  parser.end();
  return decoded;
};

/**
 * Sets a decoded value back: the rewriter escapes only quotes, so `&` is
 * written as `&amp;` to keep it from being read as a reference.
 */
export const writeAttribute = (
  element: Element,
  name: string,
  value: string
) => {
  element.setAttribute(name, value.replaceAll("&", "&amp;"));
};

export const htmlResponse = (html: string) =>
  new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** Runs `callback` at the element's end tag; void elements have none. */
export const atEndTag = (element: Element, callback: () => void) => {
  try {
    element.onEndTag(callback);
  } catch {
    callback();
  }
};

/**
 * A streaming HTML rewriter: a global in Workers and in Bun, where the tests
 * run.
 */
// biome-ignore lint/correctness/noUndeclaredVariables: a Workers runtime global
export const createRewriter = (): HTMLRewriter => new HTMLRewriter();
