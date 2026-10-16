import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { Root } from "react-dom/client";
import type { SearchUrlState } from "../../lib/searchUrlState";
import type { CardsVisualFilters } from "../useCardsSearchController";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardsSearchController } = await import(
  "../useCardsSearchController"
);

type Controller = ReturnType<typeof useCardsSearchController>;

let root: Root | undefined;
let controller: Controller;

function Harness({
  initialUrlState,
  initialVisualFilters,
}: {
  initialUrlState?: SearchUrlState;
  initialVisualFilters?: CardsVisualFilters;
}) {
  controller = useCardsSearchController({
    initialUrlState,
    initialVisualFilters,
  });
  return null;
}

const mount = async (
  initialUrlState?: SearchUrlState,
  initialVisualFilters?: CardsVisualFilters
) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <Harness
        initialUrlState={initialUrlState}
        initialVisualFilters={initialVisualFilters}
      />
    )
  );
};

const card = (id: string, createdAt: number): Doc<"cards"> =>
  ({
    _creationTime: 1,
    _id: id as Id<"cards">,
    content: `design ${id}`,
    createdAt,
    type: "text",
    updatedAt: 1,
    userId: "user-1",
  }) as Doc<"cards">;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  jest.useRealTimers();
});

test("starts from the search in the URL without waiting for the debounce", async () => {
  await mount({ q: "design", sort: "oldest", types: [] });
  expect(controller.searchBarProps.searchQuery).toBe("design");
  expect(controller.queryArgs).toMatchObject({
    searchQuery: "design",
    sort: "oldest",
  });
  expect(controller.urlState).toEqual({
    q: "design",
    sort: "oldest",
    tag: "",
    types: [],
  });
});

test("a remounted screen keeps the filters the URL doesn't hold", async () => {
  const range = { end: 2000, start: 1000 };
  await mount(
    { q: "design", sort: "newest", types: [] },
    {
      hexFilters: ["#ff0000"],
      hueFilters: ["red"],
      styleFilters: ["minimal"],
      timeFilter: { kind: "range", label: "Last week", range },
    }
  );
  expect(controller.queryArgs).toMatchObject({
    createdAtRange: range,
    hexFilters: ["#ff0000"],
    hueFilters: ["red"],
    searchQuery: "design",
    styleFilters: ["minimal"],
  });
});

test("a sidebar tag in the URL narrows the query and comes back in the URL", async () => {
  await mount({ q: "", sort: "newest", tag: "design", types: [] });
  expect(controller.queryArgs.tag).toBe("design");
  expect(controller.searchBarProps.tagFilter).toBe("design");
  expect(controller.urlState.tag).toBe("design");
  await act(() =>
    controller.applyUrlState({ q: "", sort: "newest", tag: "web", types: [] })
  );
  expect(controller.queryArgs.tag).toBe("web");
  await act(() => controller.searchBarProps.onRemoveTagFilter?.());
  expect(controller.queryArgs.tag).toBeUndefined();
  expect(controller.urlState.tag).toBe("");
});

test("the default query keeps no sort argument", async () => {
  await mount();
  expect(controller.queryArgs).not.toHaveProperty("sort");
  expect(controller.urlState).toEqual({
    q: "",
    sort: "newest",
    tag: "",
    types: [],
  });
});

test("the URL follows typing only once it pauses", async () => {
  await mount();
  await act(() => controller.searchBarProps.onSearchChange("des"));
  expect(controller.urlState.q).toBe("");
  await act(() => jest.advanceTimersByTime(200));
  expect(controller.urlState.q).toBe("des");
});

test("a click applies typed text before the click's own handlers", async () => {
  await mount();
  await act(() => controller.searchBarProps.onSearchChange("des"));
  const link = document.createElement("a");
  document.body.append(link);
  let qWhenClicked: string | undefined;
  link.addEventListener("click", () => {
    qWhenClicked = controller.urlState.q;
  });
  await act(() => link.click());
  expect(qWhenClicked).toBe("des");
});

test("oldest first reorders local results and the query", async () => {
  await mount();
  await act(() =>
    controller.setRemoteCards([card("new", 3000), card("old", 1000)])
  );
  await act(() => controller.addKeywordTag("design"));
  expect(controller.displayCards.map((c) => c._id)).toEqual(["new", "old"]);

  await act(() => controller.searchBarProps.onSortChange?.("oldest"));
  expect(controller.sort).toBe("oldest");
  expect(controller.queryArgs.sort).toBe("oldest");
  expect(controller.displayCards.map((c) => c._id)).toEqual(["old", "new"]);
});

test("shuffle queries with the URL's seed and puts it back in the URL", async () => {
  await mount({ q: "", seed: 42, sort: "shuffle", types: [] });
  expect(controller.queryArgs).toMatchObject({
    shuffleSeed: 42,
    sort: "shuffle",
  });
  expect(controller.urlState).toMatchObject({ seed: 42, sort: "shuffle" });
});

test("shuffle without a seed in the URL picks one", async () => {
  await mount({ q: "", sort: "shuffle", types: [] });
  const seed = controller.queryArgs.shuffleSeed;
  expect(typeof seed).toBe("number");
  expect(controller.urlState.seed).toBe(seed);
  await act(() =>
    controller.applyUrlState({ q: "", sort: "shuffle", types: ["link"] })
  );
  expect(controller.queryArgs.shuffleSeed).toBe(seed);
});

test("choosing Shuffle picks a seed and reshuffle picks another", async () => {
  await mount();
  await act(() => controller.searchBarProps.onSortChange?.("shuffle"));
  const first = controller.queryArgs.shuffleSeed;
  expect(controller.queryArgs.sort).toBe("shuffle");
  expect(typeof first).toBe("number");
  const resetKey = controller.resetKey;

  await act(() => controller.searchBarProps.onReshuffle?.());
  expect(controller.queryArgs.shuffleSeed).not.toBe(first);
  expect(controller.urlState.seed).toBe(controller.queryArgs.shuffleSeed);
  expect(controller.resetKey).not.toBe(resetKey);

  await act(() =>
    controller.applyUrlState({ q: "", seed: first, sort: "shuffle", types: [] })
  );
  expect(controller.queryArgs.shuffleSeed).toBe(first);
  await act(() => controller.searchBarProps.onSortChange?.("newest"));
  expect(controller.queryArgs).not.toHaveProperty("shuffleSeed");
  expect(controller.urlState).not.toHaveProperty("seed");
});

test("shuffle keeps the server's order of cards", async () => {
  await mount({ q: "", seed: 7, sort: "shuffle", types: [] });
  await act(() =>
    controller.setRemoteCards([
      card("old", 1000),
      card("new", 3000),
      card("mid", 2000),
    ])
  );
  expect(controller.displayCards.map((c) => c._id)).toEqual([
    "old",
    "new",
    "mid",
  ]);
  await act(() => controller.addKeywordTag("design"));
  expect(controller.displayCards.map((c) => c._id)).toEqual([
    "old",
    "new",
    "mid",
  ]);
});

test("back and forward replace the search with the URL's", async () => {
  await mount();
  await act(() => controller.addKeywordTag("design"));
  await act(() =>
    controller.applyUrlState({ q: "colors", sort: "oldest", types: [] })
  );
  expect(controller.keywordTags).toEqual([]);
  expect(controller.searchBarProps.searchQuery).toBe("colors");
  expect(controller.sort).toBe("oldest");
});

test("back and forward apply at once, without the typing pause", async () => {
  await mount({ q: "design", sort: "newest", types: [] });
  await act(() =>
    controller.applyUrlState({ q: "colors", sort: "newest", types: [] })
  );
  expect(controller.queryArgs.searchQuery).toBe("colors");
  // A search with words starts in Best match.
  expect(controller.urlState).toEqual({
    q: "colors",
    sort: "relevance",
    tag: "",
    types: [],
  });
});

test("a search with words starts in Best match", async () => {
  await mount({ q: "lentil soup", sort: "newest", types: [] });
  expect(controller.sort).toBe("relevance");
  expect(controller.queryArgs.sort).toBe("relevance");
  expect(controller.searchBarProps.canSortByRelevance).toBe(true);
});

test("a search without words keeps newest and offers no Best match", async () => {
  await mount({ q: "type:link", sort: "relevance", types: [] });
  expect(controller.sort).toBe("newest");
  expect(controller.queryArgs.sort).toBeUndefined();
  expect(controller.searchBarProps.canSortByRelevance).toBe(false);
});

test("newest picked during a search stays until the words are cleared", async () => {
  await mount({ q: "lentil soup", sort: "newest", types: [] });
  await act(() => controller.searchBarProps.onSortChange?.("newest"));
  expect(controller.sort).toBe("newest");
  await act(() =>
    controller.applyUrlState({ q: "", sort: "newest", types: [] })
  );
  await act(() =>
    controller.applyUrlState({ q: "bread", sort: "newest", types: [] })
  );
  expect(controller.sort).toBe("relevance");
});

test("applying the search already shown keeps its chips", async () => {
  await mount();
  await act(() => controller.addKeywordTag("design"));
  await act(() =>
    controller.applyUrlState({ q: "design", sort: "newest", types: [] })
  );
  expect(controller.keywordTags).toEqual(["design"]);
  expect(controller.searchBarProps.searchQuery).toBe("");
});

test("clearing filters keeps the chosen sort", async () => {
  await mount({ q: "design", sort: "oldest", types: [] });
  await act(() => controller.clearAllFilters());
  expect(controller.urlState).toEqual({
    q: "",
    sort: "oldest",
    tag: "",
    types: [],
  });
});
