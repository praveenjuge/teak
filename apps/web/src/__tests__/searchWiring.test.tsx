import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let screenProps: Record<string, any> = {};
const realScreens = await import("@/screens");
mock.module("@/screens", () => ({
  ...realScreens,
  CardsScreenAdapter: (props: Record<string, any>) => {
    screenProps = props;
    return null;
  },
}));

let currentSearch = "";
const router = { back: mock(), push: mock(), replace: mock() };
// Bun module mocks outlive this file, so keep the real exports (`redirect`
// and friends) that the auth tests import after it.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  usePathname: () => "/",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const { HomePageClient } = await import("../app/HomePageClient");

const originalWindow = globalThis.window;
const installWindow = (search: string) => {
  const history = { pushState: mock(), replaceState: mock() };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { history, location: { pathname: "/", search } },
  });
  return history;
};

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  screenProps = {};
  currentSearch = "";
  router.back.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
});

const render = (
  search: string,
  view?: "all" | "favorites" | "archive" | "trash"
) => {
  currentSearch = search;
  renderToStaticMarkup(<HomePageClient view={view} />);
};

describe("library URL", () => {
  test("hands the search and open card in the URL to the library", () => {
    render("q=blue%20buttons&sort=oldest&type=link,image&tag=UI&card=card_1");
    expect(screenProps.searchUrlState).toEqual({
      q: "blue buttons",
      sort: "oldest",
      tag: "ui",
      types: ["link", "image"],
    });
    expect(screenProps.cardIdFromUrl).toBe("card_1");
  });

  test("an unknown sort in a pasted link falls back to newest", () => {
    render("sort=random&seed=4");
    expect(screenProps.searchUrlState).toEqual({
      q: "",
      sort: "newest",
      tag: "",
      types: [],
    });
  });

  test("hands a shuffle and its seed to the library", () => {
    render("sort=shuffle&seed=42");
    expect(screenProps.searchUrlState).toEqual({
      q: "",
      seed: 42,
      sort: "shuffle",
      tag: "",
      types: [],
    });
  });

  test("typing replaces the history entry and keeps the open card", () => {
    render("card=card_1");
    const history = installWindow("?card=card_1");
    screenProps.onSearchUrlStateChange(
      { q: "design", sort: "newest", types: [] },
      { sortChanged: false, tagChanged: false, typesChanged: false }
    );
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?card=card_1&q=design"
    );
  });

  test("changing the sort adds a history entry so Back restores it", () => {
    render("q=design");
    const history = installWindow("?q=design");
    screenProps.onSearchUrlStateChange(
      { q: "design", sort: "oldest", types: [] },
      { sortChanged: true, tagChanged: false, typesChanged: false }
    );
    expect(history.pushState).toHaveBeenCalledWith(
      null,
      "",
      "/?q=design&sort=oldest"
    );
  });

  test("an unchanged search writes nothing", () => {
    render("q=design");
    const history = installWindow("?q=design");
    screenProps.onSearchUrlStateChange(
      { q: "design", sort: "newest", types: [] },
      { sortChanged: false, tagChanged: false, typesChanged: false }
    );
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  test("removing a card type adds a history entry so Back restores it", () => {
    render("type=link,image", "favorites");
    const history = installWindow("?type=link,image");
    screenProps.onSearchUrlStateChange(
      { q: "", sort: "newest", types: ["link"] },
      { sortChanged: false, tagChanged: false, typesChanged: true }
    );
    expect(history.pushState).toHaveBeenCalledWith(null, "", "/?type=link");
  });

  test("picking a sidebar tag adds a history entry so Back restores it", () => {
    render("q=blue");
    const history = installWindow("?q=blue");
    screenProps.onSearchUrlStateChange(
      { q: "blue", sort: "newest", tag: "design", types: [] },
      { sortChanged: false, tagChanged: true, typesChanged: false }
    );
    expect(history.pushState).toHaveBeenCalledWith(
      null,
      "",
      "/?q=blue&tag=design"
    );
  });

  test("hands the routed view to the library", () => {
    render("", "archive");
    expect(screenProps.view).toBe("archive");
  });

  test("a quick command in search opens that view", () => {
    render("");
    const history = installWindow("");
    screenProps.onNavigateView("trash");
    expect(router.push).toHaveBeenCalledWith("/trash");
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  test("a quick command drops its search text from this page's entry before navigating, so Back shows the page without it", () => {
    render("q=trash&sort=oldest");
    const history = installWindow("?q=trash&sort=oldest");
    const order: string[] = [];
    history.replaceState.mockImplementation(() => order.push("replace"));
    router.push.mockImplementation(() => order.push("push"));
    screenProps.onNavigateView("trash");
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?sort=oldest"
    );
    expect(router.push).toHaveBeenCalledWith("/trash");
    expect(order).toEqual(["replace", "push"]);
  });

  test("opening a card keeps the search in the URL", () => {
    render("q=design&sort=oldest");
    screenProps.pushCardId("card_9");
    expect(router.push).toHaveBeenCalledWith(
      "/?q=design&sort=oldest&card=card_9",
      { scroll: false }
    );
  });

  test("closing a card the page opened goes Back to the list entry", () => {
    render("q=design");
    screenProps.pushCardId("card_9");
    installWindow("?q=design&card=card_9");
    expect(screenProps.popCardEntry()).toBe(true);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test("after Previous or Next the card still goes Back to the list entry", () => {
    render("q=design");
    screenProps.pushCardId("card_9");
    screenProps.replaceCardId("card_10");
    installWindow("?q=design&card=card_10");
    expect(screenProps.popCardEntry()).toBe(true);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test("doesn't go Back once the URL moved on from the card it opened", () => {
    render("q=design");
    screenProps.pushCardId("card_9");
    installWindow("?q=design&card=card_9&sort=oldest");
    expect(screenProps.popCardEntry()).toBe(false);
    expect(router.back).not.toHaveBeenCalled();
  });

  test("doesn't go Back from a card it didn't open", () => {
    render("card=card_1");
    installWindow("?card=card_1");
    expect(screenProps.popCardEntry()).toBe(false);
    expect(router.back).not.toHaveBeenCalled();
  });

  test("a new-note request in the URL asks the library to focus the composer", () => {
    render("compose=1");
    expect(screenProps.focusComposer).toBe(true);
    render("");
    expect(screenProps.focusComposer).toBe(false);
  });

  test("a handled new-note request leaves the URL without it", () => {
    render("card=card_1&compose=1");
    installWindow("?card=card_1&compose=1");
    screenProps.onFocusComposerHandled();
    expect(router.replace).toHaveBeenCalledWith("/?card=card_1", {
      scroll: false,
    });
  });
});
