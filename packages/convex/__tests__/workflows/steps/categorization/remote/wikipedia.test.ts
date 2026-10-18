import { describe, expect, test } from "bun:test";
import {
  fetchWikipediaDetails,
  parseWikipediaUrl,
  wikipediaSummaryUrl,
} from "../../../../../workflows/steps/categorization/remote/wikipedia";
import { richSiteJson } from "../../../../helpers/richSites.test-utils";
import {
  hangUntilAborted,
  jsonResponse,
  socialFetch,
} from "../../../../helpers/socialFetch.test-utils";

const ARTICLE = "https://en.wikipedia.org/wiki/Ada_Lovelace";
const SUMMARY =
  "https://en.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace";

const answer = (url: string, body: unknown) =>
  socialFetch((requested) =>
    requested === url ? jsonResponse(body) : undefined
  );

describe("parseWikipediaUrl", () => {
  test.each([
    [ARTICLE, { lang: "en", title: "Ada_Lovelace" }],
    [
      "https://en.m.wikipedia.org/wiki/Ada_Lovelace",
      { lang: "en", title: "Ada_Lovelace" },
    ],
    [
      "https://ja.wikipedia.org/wiki/%E5%AF%8C%E5%A3%AB%E5%B1%B1",
      { lang: "ja", title: "富士山" },
    ],
    ["https://en.wikipedia.org/wiki/AC/DC", { lang: "en", title: "AC/DC" }],
    [
      "https://en.wikipedia.org/wiki/Mercury_(planet)#Orbit",
      { lang: "en", title: "Mercury_(planet)" },
    ],
  ])("reads %s", (url: string, ref: unknown) => {
    expect<unknown>(parseWikipediaUrl(url)).toEqual(ref);
  });

  test.each([
    "https://en.wikipedia.org/",
    "https://en.wikipedia.org/w/index.php?title=Ada",
    "https://en.wikipedia.org/wiki/",
    "https://en.wikipedia.org/wiki/..",
    "https://en.wikipedia.org/wiki/%2E%2E",
    "https://en.wikipedia.org/wiki/%E0%A4%A",
    "http://en.wikipedia.org/wiki/Ada_Lovelace",
    "https://wikipedia.org/wiki/Ada_Lovelace",
    "https://en.wikipedia.org.example.com/wiki/Ada_Lovelace",
  ])("ignores %s", (url: string) => {
    expect(parseWikipediaUrl(url)).toBeNull();
  });

  test("keeps a title with slashes or dots in one path segment", () => {
    expect(
      wikipediaSummaryUrl({ lang: "en", title: "../../v1/page/../x" })
    ).toBe(
      "https://en.wikipedia.org/api/rest_v1/page/summary/..%2F..%2Fv1%2Fpage%2F..%2Fx"
    );
    expect(wikipediaSummaryUrl({ lang: "en", title: "AC/DC" })).toBe(
      "https://en.wikipedia.org/api/rest_v1/page/summary/AC%2FDC"
    );
  });
});

describe("fetchWikipediaDetails", () => {
  test("reads the description, lead image, last edit and extract", async () => {
    const fixture = richSiteJson("wikipedia-en.json");
    const { deps, requests } = answer(SUMMARY, fixture);

    const details = await fetchWikipediaDetails(ARTICLE, deps);

    expect(requests).toEqual([SUMMARY]);
    expect(details).toEqual({
      source: "wikipedia",
      facts: [
        { label: "About", value: "English mathematician (1815–1852)" },
        { label: "Updated", value: "Oct 15, 2026" },
      ],
      imageUrl: fixture.originalimage.source,
      summary: fixture.extract,
    });
  });

  test("labels a disambiguation page and gives it no image", async () => {
    const fixture = richSiteJson("wikipedia-disambiguation.json");
    const { deps } = answer(
      "https://en.wikipedia.org/api/rest_v1/page/summary/Mercury",
      {
        ...fixture,
        thumbnail: { source: "https://upload.wikimedia.org/x.png" },
      }
    );

    const details = await fetchWikipediaDetails(
      "https://en.wikipedia.org/wiki/Mercury",
      deps
    );

    expect(details?.facts).toEqual([
      { label: "Page", value: "Disambiguation" },
      { label: "Updated", value: "Oct 13, 2026" },
    ]);
    expect(details?.imageUrl).toBeUndefined();
  });

  test("keeps a Japanese description whole", async () => {
    const fixture = richSiteJson("wikipedia-ja.json");
    const { deps, requests } = answer(
      "https://ja.wikipedia.org/api/rest_v1/page/summary/%E5%AF%8C%E5%A3%AB%E5%B1%B1",
      fixture
    );

    const details = await fetchWikipediaDetails(
      "https://ja.wikipedia.org/wiki/%E5%AF%8C%E5%A3%AB%E5%B1%B1",
      deps
    );

    expect(requests).toHaveLength(1);
    expect(details?.facts?.[0]).toEqual({
      label: "About",
      value: fixture.description,
    });
  });

  test("an image off Wikimedia is dropped", async () => {
    const { deps } = answer(SUMMARY, {
      description: "Test",
      originalimage: { source: "https://attacker.example/x.png" },
      thumbnail: { source: "http://upload.wikimedia.org/x.png" },
      type: "standard",
    });

    const details = await fetchWikipediaDetails(ARTICLE, deps);

    expect(details?.imageUrl).toBeUndefined();
  });

  test.each([
    ["a missing page", () => new Response("{}", { status: 404 })],
    ["a rate limit", () => new Response("Too many", { status: 429 })],
    ["a body that isn't JSON", () => new Response("<html>")],
    [
      "a body over 256 KiB",
      () => jsonResponse({ extract: "x".repeat(300 * 1024) }),
    ],
  ])("%s gives nothing", async (_name: string, respond: () => Response) => {
    const { deps } = socialFetch(() => respond());

    expect(await fetchWikipediaDetails(ARTICLE, deps)).toBeNull();
  });

  test("a request that never answers times out", async () => {
    const { deps } = socialFetch((_url, init) => hangUntilAborted(init));

    expect(
      await fetchWikipediaDetails(ARTICLE, { ...deps, timeoutMs: 20 })
    ).toBeNull();
  });

  test("a redirect to a private address is refused", async () => {
    const { deps, requests } = socialFetch(
      (url) =>
        url === SUMMARY
          ? Response.redirect("https://internal.example/", 302)
          : jsonResponse({ description: "secret" }),
      { addresses: ["93.184.216.34"] }
    );
    const resolveDns = async (hostname: string) =>
      hostname === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"];

    expect(
      await fetchWikipediaDetails(ARTICLE, { ...deps, resolveDns })
    ).toBeNull();
    expect(requests).toEqual([SUMMARY]);
  });
});
