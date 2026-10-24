/** Small HTML helpers the archive's passes share. */

import { Parser } from "htmlparser2";

const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).byteLength;

/** `&`, quotes and angle brackets, for a value inside a quoted attribute. */
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
