import type {
  ScrapeAttribute,
  ScrapeResultItem,
  ScrapeSelectorResult,
} from "./types";

const TITLE_TAG_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
// `meta` or `link` with one or more `[attr='value']` conditions, like
// `meta[itemprop='duration']` or `link[rel='alternate'][type='...']`.
const TAG_SELECTOR_REGEX = /^(meta|link)((?:\[[\w:-]+=['"][^'"]+['"]\])+)$/i;
const CONDITION_REGEX = /\[([\w:-]+)=['"]([^'"]+)['"]\]/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};
const ENTITY_REGEX = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi;
const MAX_CODE_POINT = 0x10_ff_ff;

export const decodeHtmlEntities = (value: string): string =>
  value.replace(
    ENTITY_REGEX,
    (entity, hex: string | undefined, decimal: string | undefined, name) => {
      if (hex !== undefined || decimal !== undefined) {
        const codePoint = hex
          ? Number.parseInt(hex, 16)
          : Number.parseInt(decimal ?? "", 10);
        return codePoint <= MAX_CODE_POINT
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return NAMED_ENTITIES[(name as string).toLowerCase()] ?? entity;
    }
  );

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
    const tagMatch = normalizedSelector.match(TAG_SELECTOR_REGEX);
    if (tagMatch) {
      const conditions = [...tagMatch[2].matchAll(CONDITION_REGEX)].map(
        ([, name, value]) => ({
          name: name.toLowerCase(),
          value: value.toLowerCase(),
        })
      );
      const tags = tagMatch[1].toLowerCase() === "meta" ? metaTags : linkTags;
      const results = tags.filter((item) => {
        const attributes = item.attributes ?? [];
        return conditions.every(
          (condition) =>
            attributes
              .find((attr) => attr.name.toLowerCase() === condition.name)
              ?.value?.trim()
              .toLowerCase() === condition.value
        );
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
