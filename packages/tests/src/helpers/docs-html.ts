import { Parser } from "htmlparser2";

/** The title and first 20 internal links the docs crawler checks. */
export const readDocsHtml = (
  html: string
): { internalLinks: string[]; title: string | undefined } => {
  const internalLinks: string[] = [];
  let title: string | undefined;
  let inTitle = false;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "title" && title === undefined) {
        title = "";
        inTitle = true;
      }
      const href = attributes.href;
      if (
        name === "a" &&
        href?.startsWith("/") &&
        // Email obfuscation links need client-side decoding, not a fetch.
        !href.startsWith("/cdn-cgi/") &&
        internalLinks.length < 20
      ) {
        internalLinks.push(href);
      }
    },
    ontext(text) {
      if (inTitle) {
        title += text;
      }
    },
    onclosetag(name) {
      if (name === "title") {
        inTitle = false;
      }
    },
  });
  parser.end(html);
  return { internalLinks, title: title?.trim() };
};
