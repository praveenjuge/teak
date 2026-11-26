import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

const { renderToStaticMarkup } = await import("react-dom/server");
const { TestRouter, testRouter } = await import("./helpers/router");
const { useLibraryUrl } = await import("../hooks/useLibraryUrl");

let screenProps: Record<string, any> = {};
let router: ReturnType<typeof testRouter>;

function Harness() {
  screenProps = useLibraryUrl();
  return null;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// The library at `search`, with a router on the window's history as in the
// app, so navigations land in real history entries.
const render = (search: string) => {
  window.history.replaceState(null, "", search ? `/?${search}` : "/");
  router = testRouter("/", { browser: true });
  renderToStaticMarkup(
    <TestRouter router={router}>
      <Harness />
    </TestRouter>
  );
};

// The router writes the browser's history a microtask later; tests read it
// straight after.
const url = () => {
  router.history.flush();
  return `${window.location.pathname}${window.location.search}`;
};
const entries = () => {
  router.history.flush();
  return window.history.length;
};
const back = async () => {
  router.history.flush();
  window.history.back();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return `${window.location.pathname}${window.location.search}`;
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
    const before = entries();
    screenProps.onSearchUrlStateChange(
      { q: "design", sort: "newest", types: [] },
      { sortChanged: false, tagChanged: false, typesChanged: false }
    );
    expect(url()).toBe("/?card=card_1&q=design");
    expect(entries()).toBe(before);
  });

  test("changing the sort adds a history entry so Back restores it", async () => {
    render("q=design");
    const before = entries();
    screenProps.onSearchUrlStateChange(
      { q: "design", sort: "oldest", types: [] },
      { sortChanged: true, tagChanged: false, typesChanged: false }
    );
    expect(url()).toBe("/?q=design&sort=oldest");
    expect(entries()).toBe(before + 1);
    expect(await back()).toBe("/?q=design");
  });

  test("an unchanged search writes nothing", () => {
    render("q=design");
    const before = entries();
    const navigate = spyOn(router, "navigate");
    screenProps.onSearchUrlStateChange(
      { q: "design", sort: "newest", types: [] },
      { sortChanged: false, tagChanged: false, typesChanged: false }
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(url()).toBe("/?q=design");
    expect(entries()).toBe(before);
  });

  test("removing a card type adds a history entry so Back restores it", async () => {
    render("type=link,image");
    screenProps.onSearchUrlStateChange(
      { q: "", sort: "newest", types: ["link"] },
      { sortChanged: false, tagChanged: false, typesChanged: true }
    );
    expect(url()).toBe("/?type=link");
    expect(await back()).toBe("/?type=link,image");
  });

  test("picking a sidebar tag adds a history entry so Back restores it", async () => {
    render("q=blue");
    screenProps.onSearchUrlStateChange(
      { q: "blue", sort: "newest", tag: "design", types: [] },
      { sortChanged: false, tagChanged: true, typesChanged: false }
    );
    expect(url()).toBe("/?q=blue&tag=design");
    expect(await back()).toBe("/?q=blue");
  });

  test("keeps the same search while a card opens and closes", () => {
    render("q=design&card=card_1");
    const withCard = screenProps.searchUrlState;
    render("q=design");
    expect(screenProps.searchUrlState).toEqual(withCard);
  });

  test("a quick command in search opens that view", async () => {
    render("");
    screenProps.onNavigateView("trash");
    expect(url()).toBe("/trash");
    expect(await back()).toBe("/");
  });

  test("a quick command drops its search text from this page's entry before navigating, so Back shows the page without it", async () => {
    render("q=trash&sort=oldest");
    screenProps.onNavigateView("trash");
    expect(url()).toBe("/trash");
    expect(await back()).toBe("/?sort=oldest");
  });

  test("a typed search that settles while a quick command leaves the page doesn't cancel the move", async () => {
    render("");
    screenProps.onNavigateView("trash");
    // The search box's own write for "trash", flushed by React right after
    // the Enter that started the move, then the emptied box.
    screenProps.onSearchUrlStateChange(
      { q: "trash", sort: "newest", types: [] },
      { sortChanged: false, tagChanged: false, typesChanged: false }
    );
    screenProps.onSearchUrlStateChange(
      { q: "", sort: "newest", types: [] },
      { sortChanged: false, tagChanged: false, typesChanged: false }
    );
    expect(url()).toBe("/trash");
    expect(await back()).toBe("/");
  });

  test("Search everything reruns this page's search in the library and leaves this entry alone, so Back returns to it", async () => {
    render("q=tomato%20soup&type=link,image&card=card_1");
    screenProps.onSearchEverything();
    expect(url()).toBe("/?q=tomato+soup&type=link,image");
    expect(await back()).toBe("/?q=tomato%20soup&type=link,image&card=card_1");
  });

  test("opening a card keeps the search in the URL and the scroll position", async () => {
    render("q=design&sort=oldest");
    const navigate = spyOn(router, "navigate");
    screenProps.pushCardId("card_9");
    expect(url()).toBe("/?q=design&sort=oldest&card=card_9");
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ resetScroll: false })
    );
    expect(await back()).toBe("/?q=design&sort=oldest");
  });

  test("closing a card the page opened goes Back to the list entry", async () => {
    render("q=design");
    screenProps.pushCardId("card_9");
    expect(url()).toBe("/?q=design&card=card_9");
    expect(screenProps.popCardEntry()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(url()).toBe("/?q=design");
  });

  test("closing a card opened under a type filter goes Back to the list entry", async () => {
    render("type=link,image");
    screenProps.pushCardId("card_9");
    expect(url()).toBe("/?type=link,image&card=card_9");
    expect(screenProps.popCardEntry()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(url()).toBe("/?type=link,image");
  });

  test("after Previous or Next the card still goes Back to the list entry", async () => {
    render("q=design");
    screenProps.pushCardId("card_9");
    screenProps.replaceCardId("card_10");
    expect(url()).toBe("/?q=design&card=card_10");
    expect(screenProps.popCardEntry()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(url()).toBe("/?q=design");
  });

  test("doesn't go Back once the URL moved on from the card it opened", () => {
    render("q=design");
    screenProps.pushCardId("card_9");
    url();
    window.history.replaceState(null, "", "/?q=design&card=card_9&sort=oldest");
    expect(screenProps.popCardEntry()).toBe(false);
    expect(url()).toBe("/?q=design&card=card_9&sort=oldest");
  });

  test("doesn't go Back from a card it didn't open", async () => {
    render("q=design");
    window.history.pushState(null, "", "/?card=card_1");
    render("card=card_1");
    expect(screenProps.popCardEntry()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(url()).toBe("/?card=card_1");
  });

  test("a new-note request in the URL asks the library to focus the composer", () => {
    render("compose=1");
    expect(screenProps.focusComposer).toBe(true);
    render("");
    expect(screenProps.focusComposer).toBe(false);
  });

  test("a handled new-note request leaves the URL without it", () => {
    render("card=card_1&compose=1");
    const before = entries();
    const navigate = spyOn(router, "navigate");
    screenProps.onFocusComposerHandled();
    expect(url()).toBe("/?card=card_1");
    expect(entries()).toBe(before);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ resetScroll: false })
    );
  });
});
