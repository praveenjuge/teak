import { describe, expect, test } from "bun:test";
import { api } from "@teak/convex";
import { getFunctionName } from "convex/server";
import { convexToJson } from "convex/values";
import { renderToStaticMarkup } from "react-dom/server";
import { useCardsSearchController } from "../../hooks/useCardsSearchController";
import { firstLoadQueries } from "../firstLoadQueries";
import type { LibraryView } from "../libraryViews";
import { libraryViewForPath } from "../libraryViews";
import { parseSearchUrlState } from "../searchUrlState";

function libraryFirstQuery(url: URL, view: LibraryView) {
  let args: unknown;
  function Probe() {
    args = useCardsSearchController({
      initialUrlState: parseSearchUrlState(url.searchParams),
      view,
    }).queryArgs;
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return args;
}

const warmedCardsArgs = (url: URL) => {
  const cards = firstLoadQueries(url).find(
    ({ query }) =>
      getFunctionName(query) === getFunctionName(api.cards.searchCardsPaginated)
  );
  if (!cards) {
    return;
  }
  const { paginationOpts, ...args } = cards.args;
  return { args, paginationOpts };
};

const names = (url: URL) =>
  firstLoadQueries(url).map(({ query }) => getFunctionName(query));

describe("first-load queries", () => {
  test.each([
    "/",
    "/favorites",
    "/archive",
    "/trash",
    "/?q=bauhaus",
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

  test("skip the cards for Shuffle without a seed, which picks one at random", () => {
    const url = new URL("/?sort=shuffle", "https://app.example");
    expect(warmedCardsArgs(url)).toBeUndefined();
    expect(names(url)).toContain("card/vaultSetup:getVaultSetup");
  });

  test("warm the vault setup, not a page of cards, in a folder", () => {
    const url = new URL("/f/folder123", "https://app.example");
    expect(names(url)).toEqual([
      "auth:getAuthUser",
      "auth:getCardCreationStatus",
      "folders:listFolders",
      "card/vaultSetup:getVaultSetup",
    ]);
  });

  test("warm only the profile and sidebar outside the library", () => {
    const url = new URL("/settings", "https://app.example");
    expect(names(url)).toEqual([
      "auth:getAuthUser",
      "auth:getCardCreationStatus",
      "folders:listFolders",
    ]);
  });
});
