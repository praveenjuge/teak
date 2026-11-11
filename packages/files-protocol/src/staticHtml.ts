import type {
  FilesScrapeAttribute,
  FilesScrapeResultItem,
  FilesScrapeSelectorResult,
} from "./rendering";

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
const SURROGATE_MIN = 0xd8_00;
const SURROGATE_MAX = 0xdf_ff;

export const decodeHtmlEntities = (value: string): string =>
  value.replace(
    ENTITY_REGEX,
    (entity, hex: string | undefined, decimal: string | undefined, name) => {
      if (hex !== undefined || decimal !== undefined) {
        const codePoint = hex
          ? Number.parseInt(hex, 16)
          : Number.parseInt(decimal ?? "", 10);
        // A surrogate on its own is no character: `&#xD83D;` stays as text.
        return codePoint <= MAX_CODE_POINT &&
          !(codePoint >= SURROGATE_MIN && codePoint <= SURROGATE_MAX)
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return NAMED_ENTITIES[(name as string).toLowerCase()] ?? entity;
    }
  );

const isNameEnd = (char: string) =>
  char === "=" || char === "/" || char === ">" || /\s/u.test(char);

const skipSpace = (text: string, from: number) => {
  let index = from;
  while (index < text.length && /\s/u.test(text[index])) {
    index += 1;
  }
  return index;
};

const readValue = (
  tag: string,
  from: number
): { end: number; value: string } | null => {
  const quote = tag[from];
  if (quote === '"' || quote === "'") {
    const close = tag.indexOf(quote, from + 1);
    return close === -1
      ? null
      : { end: close + 1, value: tag.slice(from + 1, close) };
  }
  let end = from;
  while (end < tag.length && !/[\s"'>]/u.test(tag[end])) {
    end += 1;
  }
  return end === from ? null : { end, value: tag.slice(from, end) };
};

// One pass over the tag: an attribute is a name, `=` and a quoted or bare
// value; anything else is stepped over. Pages are untrusted, so no step may
// rescan text it has already passed.
const extractTagAttributes = (tag: string): FilesScrapeAttribute[] => {
  const attributes: FilesScrapeAttribute[] = [];
  let index = 0;
  while (index < tag.length) {
    if (isNameEnd(tag[index])) {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (index < tag.length && !isNameEnd(tag[index])) {
      index += 1;
    }
    const name = tag.slice(nameStart, index);
    const equals = skipSpace(tag, index);
    if (tag[equals] !== "=") {
      continue;
    }
    const value = readValue(tag, skipSpace(tag, equals + 1));
    if (!value) {
      continue;
    }
    attributes.push({ name, value: decodeHtmlEntities(value.value) });
    index = value.end;
  }
  return attributes;
};

const TITLE_OPEN = /<title/i;
const TITLE_CLOSE = /<\/title>/gi;

const readTitle = (html: string): string | undefined => {
  const open = html.search(TITLE_OPEN);
  if (open === -1) {
    return undefined;
  }
  const contentStart = html.indexOf(">", open) + 1;
  if (contentStart === 0) {
    return undefined;
  }
  TITLE_CLOSE.lastIndex = contentStart;
  const close = TITLE_CLOSE.exec(html);
  return close ? html.slice(contentStart, close.index) : undefined;
};

const readTags = (html: string, start: RegExp): FilesScrapeResultItem[] => {
  const tags: FilesScrapeResultItem[] = [];
  let open = start.exec(html);
  while (open !== null) {
    const end = html.indexOf(">", open.index);
    // No `>` after this tag means none after any later one either.
    if (end === -1) {
      break;
    }
    const attributes = extractTagAttributes(html.slice(open.index, end + 1));
    if (attributes.length) {
      tags.push({ attributes });
    }
    start.lastIndex = end + 1;
    open = start.exec(html);
  }
  return tags;
};

export const buildSelectorResultsFromHtml = (
  html: string,
  selectors: { selector: string }[]
): FilesScrapeSelectorResult[] => {
  const metaTags = readTags(html, /<meta\b/gi);
  const linkTags = readTags(html, /<link\b/gi);

  const title = readTitle(html);
  const titleText =
    title === undefined
      ? undefined
      : decodeHtmlEntities(title).replace(/\s+/g, " ").trim();

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
