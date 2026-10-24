import type { DevScenarioCardDef } from "../card/defaultCards";

const URL_VARIANTS_START = Date.UTC(2025, 0, 1);

/**
 * The link each card is saved from, with the rule it exercises. The pack seeds
 * each one twice: under `/k/` as a card saved today (with `urlKey`), and under
 * `/l/` as one with no `urlKey`, which the duplicate check finds only by its
 * exact address (the fallback `.agents/sunset.md` keeps).
 */
const VARIANT_LINKS: {
  path: string;
  note: string;
  isArchived?: true;
  isDeleted?: true;
}[] = [
  {
    path: "https://www.example.com/url-variants/{v}/www/",
    note: "Matches without www. or the trailing slash",
  },
  {
    path: "http://example.com/url-variants/{v}/scheme",
    note: "Matches over https",
  },
  {
    path: "https://example.com/url-variants/{v}/slash/",
    note: "Matches without the trailing slash",
  },
  {
    path: "https://example.com/url-variants/{v}/fragment#section",
    note: "Matches with no fragment or another one",
  },
  {
    path: "https://example.com/url-variants/{v}/app#/route",
    note: "A #/ route: matches only with #/route",
  },
  {
    path: "https://example.com/url-variants/{v}/bang#!/route",
    note: "A #! route: matches only with #!/route",
  },
  {
    path: "https://example.com/url-variants/{v}/utm?utm_source=x&utm_medium=y",
    note: "Matches with no parameters",
  },
  {
    path: "https://example.com/url-variants/{v}/fbclid?fbclid=abc",
    note: "Matches with no parameters",
  },
  {
    path: "https://example.com/url-variants/{v}/gclid?gclid=abc",
    note: "Matches with no parameters",
  },
  {
    path: "https://example.com/url-variants/{v}/mixed?id=1&utm_source=x",
    note: "Matches ?id=1",
  },
  {
    path: "https://example.com/url-variants/{v}/ids?id=1",
    note: "Never matches ?id=2",
  },
  {
    path: "https://example.com/url-variants/{v}/ids?id=2",
    note: "Never matches ?id=1",
  },
  {
    path: "https://example.com/url-variants/{v}/order?b=2&a=1",
    note: "Parameter order counts",
  },
  {
    path: "https://example.com/url-variants/{v}/order?a=1&b=2",
    note: "Parameter order counts",
  },
  {
    path: "https://EXAMPLE.com/url-variants/{v}/Case",
    note: "The host's case doesn't count; the path's does",
  },
  {
    path: "https://example.com/url-variants/{v}/case",
    note: "Never matches /Case",
  },
  {
    path: "https://example.com:443/url-variants/{v}/port443",
    note: "Matches without :443",
  },
  {
    path: "https://example.com:8080/url-variants/{v}/port8080",
    note: "Never matches without :8080",
  },
  {
    path: "https://例え.jp/url-variants/{v}/パス",
    note: "An IDN host and a non-ASCII path",
  },
  {
    path: "https://example.com/url-variants/{v}/%E2%9C%93-encoded",
    note: "A percent-encoded path",
  },
  {
    path: `https://example.com/url-variants/{v}/long/${"a".repeat(1900)}`,
    note: "A 2,000-character address",
  },
  {
    path: "https://example.com/url-variants/{v}/twice",
    note: "One of two cards for one link: the newer wins",
  },
  {
    path: "https://www.example.com/url-variants/{v}/twice/",
    note: "The newer of two cards for one link",
  },
  {
    path: "https://example.com/url-variants/{v}/archived",
    note: "Archived: still matches",
    isArchived: true,
  },
  {
    path: "https://example.com/url-variants/{v}/trashed",
    note: "In Trash: never matches",
    isDeleted: true,
  },
];

export const urlVariantsScenarioPage = (page: number): DevScenarioCardDef[] =>
  page === 0
    ? (["k", "l"] as const).flatMap((version, set) =>
        VARIANT_LINKS.map((link, index) => {
          const url = link.path.replace("{v}", version);
          return {
            type: "link" as const,
            content: url,
            url,
            notes: link.note,
            createdAt: URL_VARIANTS_START + (set * 100 + index) * 3_600_000,
            tags: ["scenario-url-variants"],
            ...(link.isArchived ? { isArchived: true } : {}),
            ...(link.isDeleted ? { isDeleted: true } : {}),
            ...(version === "l" ? { beforeUrlKey: true as const } : {}),
          };
        })
      )
    : [];
