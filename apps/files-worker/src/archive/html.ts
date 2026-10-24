/** Small HTML helpers the archive's passes share. */

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
