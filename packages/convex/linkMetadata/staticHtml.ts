/**
 * Static preview metadata: the page's <meta>, <link> and <title> tags matched
 * against the scrape selectors, without running the page. Pure, so scripts
 * can reuse exactly what the link metadata step does.
 */

import type {
  ScrapeAttribute,
  ScrapeResultItem,
  ScrapeSelectorResult,
} from "./types";

const TITLE_TAG_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_SELECTOR_REGEX = /^meta\[(property|name)=['"]([^'"]+)['"]\]$/i;
const LINK_SELECTOR_REGEX = /^link\[rel=['"]([^'"]+)['"]\]$/i;

const decodeHtmlEntities = (value: string): string => {
  // Decode &amp; LAST to prevent double-unescaping vulnerabilities
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, num) =>
      String.fromCharCode(Number.parseInt(num, 10))
    )
    .replace(/&amp;/gi, "&");
};

const extractTagAttributes = (tag: string): ScrapeAttribute[] => {
  const attributes: ScrapeAttribute[] = [];
  const regex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null = regex.exec(tag);
  while (match !== null) {
    const name = match[1];
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.push({
      name,
      value: decodeHtmlEntities(rawValue),
    });
    match = regex.exec(tag);
  }
  return attributes;
};

export const buildSelectorResultsFromHtml = (
  html: string,
  selectors: { selector: string }[]
): ScrapeSelectorResult[] => {
  const metaTags: ScrapeResultItem[] = [];
  const linkTags: ScrapeResultItem[] = [];

  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = metaRegex.exec(html);
  while (match !== null) {
    const attributes = extractTagAttributes(match[0]);
    if (attributes.length) {
      metaTags.push({ attributes });
    }
    match = metaRegex.exec(html);
  }

  const linkRegex = /<link\b[^>]*>/gi;
  match = linkRegex.exec(html);
  while (match !== null) {
    const attributes = extractTagAttributes(match[0]);
    if (attributes.length) {
      linkTags.push({ attributes });
    }
    match = linkRegex.exec(html);
  }

  const titleMatch = html.match(TITLE_TAG_REGEX);
  const titleText = titleMatch
    ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim()
    : undefined;

  return selectors.map(({ selector }) => {
    const normalizedSelector = selector.trim();
    const metaMatch = normalizedSelector.match(META_SELECTOR_REGEX);
    if (metaMatch) {
      const attrName = metaMatch[1].toLowerCase();
      const expectedValue = metaMatch[2].toLowerCase();
      const results = metaTags.filter((item) => {
        const attributes = item.attributes ?? [];
        const matchAttr = attributes.find(
          (attr) => attr.name.toLowerCase() === attrName
        );
        return matchAttr?.value?.toLowerCase() === expectedValue;
      });
      return { selector: normalizedSelector, results };
    }

    const linkMatch = normalizedSelector.match(LINK_SELECTOR_REGEX);
    if (linkMatch) {
      const expectedValue = linkMatch[1].toLowerCase();
      const results = linkTags.filter((item) => {
        const attributes = item.attributes ?? [];
        const matchAttr = attributes.find(
          (attr) => attr.name.toLowerCase() === "rel"
        );
        return matchAttr?.value?.trim().toLowerCase() === expectedValue;
      });
      return { selector: normalizedSelector, results };
    }

    if (normalizedSelector.toLowerCase() === "head > title") {
      return {
        selector: normalizedSelector,
        results: titleText ? [{ text: titleText }] : [],
      };
    }

    return { selector: normalizedSelector, results: [] };
  });
};
