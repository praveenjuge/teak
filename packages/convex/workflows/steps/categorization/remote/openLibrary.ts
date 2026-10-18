import { getRawAttribute, type RawSelectorMap } from "../providers/common";
import {
  buildFacts,
  factValue,
  fetchRemoteJson,
  formatAuthors,
  type RemoteDetails,
  type RemoteFetchDeps,
} from "./common";

// A book's author, pages, publisher, date and ISBN from Open Library, for a
// book link whose page names an ISBN, plus its cover when the page has none.

const ISBN_SEPARATORS_REGEX = /[\s-]/g;
const ISBN_10_REGEX = /^\d{9}[\dX]$/;
const ISBN_13_REGEX = /^97[89]\d{10}$/;
const AMAZON_ISBN_PATH_REGEX = /\/(?:dp|gp\/product)\/(\d{9}[\dXx])(?:[/?]|$)/;
const AUTHOR_KEY_REGEX = /^\/authors\/OL\d+A$/;
const MAX_AUTHOR_LOOKUPS = 2;

interface OpenLibraryEdition {
  authors?: Array<{ key?: string }>;
  covers?: number[];
  isbn_10?: string[];
  isbn_13?: string[];
  number_of_pages?: number;
  publish_date?: string;
  publishers?: string[];
}

const isValidIsbn10 = (isbn: string): boolean => {
  if (!ISBN_10_REGEX.test(isbn)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = isbn[index];
    const digit = char === "X" ? 10 : Number(char);
    sum += (10 - index) * digit;
  }
  return sum % 11 === 0;
};

const isValidIsbn13 = (isbn: string): boolean => {
  if (!ISBN_13_REGEX.test(isbn)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(isbn[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
};

/** An ISBN-10 or ISBN-13 without separators, if its check digit is right. */
export const normalizeIsbn = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") {
    return;
  }
  const isbn = String(value).replace(ISBN_SEPARATORS_REGEX, "").toUpperCase();
  return isValidIsbn10(isbn) || isValidIsbn13(isbn) ? isbn : undefined;
};

const bookIsbns = (entities: unknown[]): unknown[] =>
  entities.flatMap((entity) => {
    const record = entity as Record<string, unknown> | null;
    const types = [record?.["@type"]].flat();
    return types.includes("Book") ? [record?.isbn].flat() : [];
  });

/**
 * The first valid ISBN on the page: its `books:isbn` tag, JSON-LD
 * `Book.isbn`, or an Amazon `/dp/<ISBN-10>` path.
 */
export const findIsbn = ({
  entities,
  provider,
  rawMap,
  sourceUrl,
}: {
  entities: unknown[];
  provider?: string;
  rawMap: RawSelectorMap;
  sourceUrl: string;
}): string | undefined => {
  const candidates: unknown[] = [
    getRawAttribute(rawMap, "meta[property='books:isbn']", "content"),
    ...bookIsbns(entities),
  ];
  if (provider === "amazon") {
    try {
      candidates.push(
        new URL(sourceUrl).pathname.match(AMAZON_ISBN_PATH_REGEX)?.[1]
      );
    } catch {
      // Not a URL; nothing to read from it.
    }
  }
  for (const candidate of candidates) {
    const isbn = normalizeIsbn(candidate);
    if (isbn) {
      return isbn;
    }
  }
};

const authorNames = async (
  edition: OpenLibraryEdition,
  deps: RemoteFetchDeps
): Promise<string[]> => {
  const keys = (edition.authors ?? [])
    .map((author) => author?.key)
    .filter((key): key is string => !!key && AUTHOR_KEY_REGEX.test(key))
    .slice(0, MAX_AUTHOR_LOOKUPS);
  const authors = await Promise.all(
    keys.map((key) =>
      fetchRemoteJson<{ name?: unknown }>(
        `https://openlibrary.org${key}.json`,
        deps
      )
    )
  );
  return authors
    .map(({ data }) => data?.name)
    .filter((name): name is string => typeof name === "string");
};

export const fetchOpenLibraryDetails = async (
  isbn: string,
  deps: RemoteFetchDeps
): Promise<RemoteDetails | null> => {
  const { data: edition } = await fetchRemoteJson<OpenLibraryEdition>(
    `https://openlibrary.org/isbn/${isbn}.json`,
    deps
  );
  if (!edition || typeof edition !== "object") {
    return null;
  }
  const names = await authorNames(edition, deps);
  const pages = edition.number_of_pages;
  const details: RemoteDetails = {
    source: "open_library",
    facts: buildFacts([
      ["Authors", factValue(formatAuthors(names))],
      [
        "Pages",
        Number.isSafeInteger(pages) && (pages as number) > 0
          ? String(pages)
          : undefined,
      ],
      ["Publisher", factValue(edition.publishers?.[0])],
      ["Published", factValue(edition.publish_date)],
      ["ISBN", normalizeIsbn(edition.isbn_13?.[0]) ?? isbn],
    ]),
  };
  if (
    edition.covers?.some((cover) => Number.isSafeInteger(cover) && cover > 0)
  ) {
    details.imageUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  }
  return details;
};
