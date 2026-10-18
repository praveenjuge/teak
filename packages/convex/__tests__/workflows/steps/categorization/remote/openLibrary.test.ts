import { describe, expect, test } from "bun:test";
import { buildRawSelectorMap } from "../../../../../workflows/steps/categorization/enrichment";
import {
  fetchOpenLibraryDetails,
  findIsbn,
  normalizeIsbn,
} from "../../../../../workflows/steps/categorization/remote/openLibrary";
import { richSiteJson } from "../../../../helpers/richSites.test-utils";
import {
  jsonResponse,
  socialFetch,
} from "../../../../helpers/socialFetch.test-utils";

const ISBN_13 = "9780140328721";
const EDITION = `https://openlibrary.org/isbn/${ISBN_13}.json`;
const AUTHOR = "https://openlibrary.org/authors/OL34184A.json";

const library = (
  edition: unknown = richSiteJson("openlibrary-isbn13.json"),
  author: unknown = richSiteJson("openlibrary-author.json")
) =>
  socialFetch((url) => {
    if (url === EDITION) {
      return jsonResponse(edition);
    }
    if (url === AUTHOR) {
      return jsonResponse(author);
    }
  });

const isbnTag = (value: string) =>
  buildRawSelectorMap([
    {
      selector: "meta[property='books:isbn']",
      results: [{ attributes: [{ name: "content", value }] }],
    },
  ]);

describe("normalizeIsbn", () => {
  test.each([
    ["9780140328721", "9780140328721"],
    ["978-0-14-032872-1", "9780140328721"],
    ["0140328726", "0140328726"],
    ["0-8044-2957-x", "080442957X"],
    [9_780_140_328_721, "9780140328721"],
  ])("accepts %s", (value: string | number, isbn: string) => {
    expect(normalizeIsbn(value)).toBe(isbn);
  });

  test.each([
    "9780140328722",
    "0140328727",
    "1234567890123",
    "97801403287",
    "978014032872X",
    "",
    "isbn",
  ])("refuses %s, whose check digit or shape is wrong", (value: string) => {
    expect(normalizeIsbn(value)).toBeUndefined();
  });
});

describe("findIsbn", () => {
  const sourceUrl = "https://www.goodreads.com/book/show/6693";

  test("reads the books:isbn tag first", () => {
    expect(
      findIsbn({
        entities: [{ "@type": "Book", isbn: "0140328726" }],
        rawMap: isbnTag(ISBN_13),
        sourceUrl,
      })
    ).toBe(ISBN_13);
  });

  test("reads JSON-LD Book.isbn when the tag is missing or wrong", () => {
    expect(
      findIsbn({
        entities: [{ "@type": "Book", isbn: "0140328726" }],
        rawMap: isbnTag("9780140328722"),
        sourceUrl,
      })
    ).toBe("0140328726");
  });

  test("reads a Book nested under @graph", () => {
    expect(
      findIsbn({
        entities: [
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "WebPage" },
              { "@type": "Book", isbn: "0140328726" },
            ],
          },
        ],
        rawMap: buildRawSelectorMap([]),
        sourceUrl,
      })
    ).toBe("0140328726");
  });

  test("reads a Book that is a page's single @graph node", () => {
    expect(
      findIsbn({
        entities: [
          {
            "@context": "https://schema.org",
            "@graph": { "@type": "Book", isbn: "0140328726" },
          },
        ],
        rawMap: buildRawSelectorMap([]),
        sourceUrl,
      })
    ).toBe("0140328726");
  });

  test("reads an Amazon /dp/ ISBN-10 on Amazon only", () => {
    const rawMap = buildRawSelectorMap([]);
    expect(
      findIsbn({
        entities: [],
        provider: "amazon",
        rawMap,
        sourceUrl: "https://www.amazon.com/Fantastic-Mr-Fox/dp/0140328726/",
      })
    ).toBe("0140328726");
    expect(
      findIsbn({
        entities: [],
        rawMap,
        sourceUrl: "https://example.com/dp/0140328726",
      })
    ).toBeUndefined();
    expect(
      findIsbn({
        entities: [],
        provider: "amazon",
        rawMap,
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      })
    ).toBeUndefined();
  });

  test("no ISBN anywhere", () => {
    expect(
      findIsbn({ entities: [], rawMap: buildRawSelectorMap([]), sourceUrl })
    ).toBeUndefined();
  });
});

describe("fetchOpenLibraryDetails", () => {
  test("reads the author, pages, publisher, date, ISBN and cover", async () => {
    const { deps, requests } = library();

    const details = await fetchOpenLibraryDetails(ISBN_13, deps);

    expect(requests).toEqual([EDITION, AUTHOR]);
    expect(details).toEqual({
      source: "open_library",
      facts: [
        { label: "Authors", value: "Roald Dahl" },
        { label: "Pages", value: "96" },
        { label: "Publisher", value: "Puffin" },
        { label: "Published", value: "October 1, 1988" },
        { label: "ISBN", value: ISBN_13 },
      ],
      imageUrl: `https://covers.openlibrary.org/b/isbn/${ISBN_13}-L.jpg?default=false`,
    });
  });

  test("an ISBN-10 shows the edition's ISBN-13", async () => {
    const { deps } = socialFetch((url) =>
      url === "https://openlibrary.org/isbn/0140328726.json"
        ? jsonResponse(richSiteJson("openlibrary-isbn13.json"))
        : undefined
    );

    const details = await fetchOpenLibraryDetails("0140328726", deps);

    expect(details?.facts).toContainEqual({ label: "ISBN", value: ISBN_13 });
  });

  test("looks up at most two authors, and only well-formed keys", async () => {
    const edition = {
      authors: [
        { key: "/authors/OL1A" },
        { key: "/authors/../../people/OL2A" },
        { key: "/authors/OL3A" },
        { key: "/authors/OL4A" },
      ],
    };
    const { deps, requests } = socialFetch((url) => {
      if (url === EDITION) {
        return jsonResponse(edition);
      }
      const id = url.match(/OL(\d)A\.json$/)?.[1];
      return id ? jsonResponse({ name: `Writer ${id}` }) : undefined;
    });

    const details = await fetchOpenLibraryDetails(ISBN_13, deps);

    expect(requests).toEqual([
      EDITION,
      "https://openlibrary.org/authors/OL1A.json",
      "https://openlibrary.org/authors/OL3A.json",
    ]);
    expect(details?.facts?.[0]).toEqual({
      label: "Authors",
      value: "Writer 1, Writer 3 et al.",
    });
  });

  test("a failed author lookup beside one that answered reads et al.", async () => {
    const { deps } = socialFetch((url) => {
      if (url === EDITION) {
        return jsonResponse({
          authors: [{ key: "/authors/OL1A" }, { key: "/authors/OL2A" }],
        });
      }
      return url.endsWith("OL1A.json")
        ? jsonResponse({ name: "Writer 1" })
        : new Response("down", { status: 503 });
    });

    const details = await fetchOpenLibraryDetails(ISBN_13, deps);

    expect(details?.facts?.[0]).toEqual({
      label: "Authors",
      value: "Writer 1 et al.",
    });
  });

  test("an edition without covers gets no image", async () => {
    const { deps } = library({ number_of_pages: 12 });

    const details = await fetchOpenLibraryDetails(ISBN_13, deps);

    expect(details?.imageUrl).toBeUndefined();
  });

  test("an author lookup that fails leaves the other facts", async () => {
    const { deps } = socialFetch((url) =>
      url === EDITION
        ? jsonResponse(richSiteJson("openlibrary-isbn13.json"))
        : new Response("down", { status: 503 })
    );

    const details = await fetchOpenLibraryDetails(ISBN_13, deps);

    expect(details?.facts?.map((fact) => fact.label)).toEqual([
      "Pages",
      "Publisher",
      "Published",
      "ISBN",
    ]);
  });

  test.each([
    ["a 404", () => new Response("{}", { status: 404 })],
    [
      "a 2 MB answer",
      () =>
        jsonResponse(
          { description: "x".repeat(2 * 1024 * 1024) },
          {
            headers: { "content-length": String(2 * 1024 * 1024) },
          }
        ),
    ],
    ["a body that isn't JSON", () => new Response("<html>")],
  ])("%s gives nothing", async (_name: string, respond: () => Response) => {
    const { deps } = socialFetch(() => respond());

    expect(await fetchOpenLibraryDetails(ISBN_13, deps)).toBeNull();
  });
});
