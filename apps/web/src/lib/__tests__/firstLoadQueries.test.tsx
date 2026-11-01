import { describe, expect, test } from "bun:test";
import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { convexToJson } from "convex/values";
import { renderToStaticMarkup } from "react-dom/server";
import { useCardsSearchController } from "../../hooks/useCardsSearchController";
import { type FirstLoadContext, firstLoadQueries } from "../firstLoadQueries";
import type { LibraryView } from "../libraryViews";
import { libraryViewForPath } from "../libraryViews";
import { parseSearchUrlState } from "../searchUrlState";

function libraryFirstQuery(url: URL, view: LibraryView, folderId?: string) {
  let args: unknown;
  function Probe() {
    args = useCardsSearchController({
      folderId: folderId as Id<"folders"> | undefined,
      initialUrlState: parseSearchUrlState(url.searchParams),
      view,
    }).queryArgs;
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return args;
}

const warmedCardsArgs = (url: URL, context?: FirstLoadContext) => {
  const cards = firstLoadQueries(url, context).find(
    ({ query }) =>
      getFunctionName(query) === getFunctionName(api.cards.searchCardsPaginated)
  );
  if (!cards) {
    return;
  }
  const { paginationOpts, ...args } = cards.args;
  return { args, paginationOpts };
};

const names = (url: URL, context?: FirstLoadContext) =>
  firstLoadQueries(url, context).map(({ query }) => getFunctionName(query));

const folders = [
  { _id: "manual123" as Id<"folders">, kind: "manual" as const },
  { _id: "smart123" as Id<"folders">, kind: "smart" as const },
];

describe("first-load queries", () => {
  test.each([
    "/",
    "/favorites",
    "/archive",
    "/trash",
    "/?q=bauhaus",
    "/?q=bauhaus&sort=newest",
    "/?q=type:link%20poster",
    "/?sort=oldest",
    "/?sort=shuffle&seed=42",
    "/?type=link,image",
    "/?tag=design",
    "/favorites?q=red&type=palette&sort=oldest",
  ])("warm the same first page of cards the library asks for at %s", (path) => {
    const url = new URL(path, "https://app.example");
    const view = libraryViewForPath(url.pathname);
    expect(view).not.toBeNull();
    const warmed = warmedCardsArgs(url);
    expect(warmed).toBeDefined();
    expect(convexToJson(warmed?.args as never)).toEqual(
      convexToJson(libraryFirstQuery(url, view as LibraryView) as never)
    );
    expect(warmed?.paginationOpts).toEqual({
      cursor: null,
      id: 0,
      numItems: 30,
    });
  });

  test("warm a search's Newest order when the URL picked it over Best match", () => {
    const url = new URL("/?q=bauhaus&sort=newest", "https://app.example");
    expect(warmedCardsArgs(url)?.args).not.toHaveProperty("sort");
  });

  test("skip the cards for Shuffle without a seed, which picks one at random", () => {
    const url = new URL("/?sort=shuffle", "https://app.example");
    expect(warmedCardsArgs(url)).toBeUndefined();
    expect(names(url)).toContain("card/vaultSetup:getVaultSetup");
  });

  test("warm the folder and vault setup, not a page of cards, in a folder the sidebar hasn't loaded", () => {
    const url = new URL("/f/folder123", "https://app.example");
    expect(names(url)).toEqual([
      "auth:getAuthUser",
      "auth:getCardCreationStatus",
      "folders:listFolders",
      "card/vaultSetup:getVaultSetup",
      "folders:getFolder",
    ]);
    expect(
      firstLoadQueries(url).find(
        ({ query }) =>
          getFunctionName(query) === getFunctionName(api.folders.getFolder)
      )?.args
    ).toEqual({ folderId: "folder123" });
  });

  test("warm the same first page of cards a manual folder asks for", () => {
    const url = new URL("/f/manual123", "https://app.example");
    const warmed = warmedCardsArgs(url, { folders });
    expect(warmed).toBeDefined();
    // Convex shares a subscription only when the arguments serialize the
    // same, key order included.
    expect(JSON.stringify(convexToJson(warmed?.args as never))).toBe(
      JSON.stringify(
        convexToJson(libraryFirstQuery(url, "all", "manual123") as never)
      )
    );
  });

  test("skip the cards of a smart folder, whose search comes with the folder", () => {
    const url = new URL("/f/smart123", "https://app.example");
    expect(warmedCardsArgs(url, { folders })).toBeUndefined();
    expect(names(url, { folders })).toContain("folders:getFolder");
  });

  test("warm the tag list on Tags", () => {
    const url = new URL("/tags", "https://app.example");
    expect(names(url)).toEqual([
      "auth:getAuthUser",
      "auth:getCardCreationStatus",
      "folders:listFolders",
      "tags:listTagSummary",
    ]);
  });

  test("warm the account, API keys and latest export on Settings", () => {
    const url = new URL("/settings", "https://app.example");
    expect(names(url)).toEqual([
      "auth:getAuthUser",
      "auth:getCardCreationStatus",
      "folders:listFolders",
      "auth:getCurrentUser",
      "apiKeys:listUserApiKeys",
      "dataExport:getLatestExport",
    ]);
  });

  test("warm only what each other Settings page shows", () => {
    const base = [
      "auth:getAuthUser",
      "auth:getCardCreationStatus",
      "folders:listFolders",
      "auth:getCurrentUser",
    ];
    const page = (path: string) => names(new URL(path, "https://app.example"));
    expect(page("/settings/plan")).toEqual(base);
    expect(page("/settings/appearance")).toEqual(base);
    expect(page("/settings/security")).toEqual(base);
    expect(page("/settings/integrations")).toEqual([
      ...base,
      "apiKeys:listUserApiKeys",
    ]);
    expect(page("/settings/data")).toEqual([
      ...base,
      "dataExport:getLatestExport",
    ]);
  });
});
