import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { Root } from "react-dom/client";
import type { SearchUrlState } from "../../lib/searchUrlState";

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

function Harness({ initialUrlState }: { initialUrlState?: SearchUrlState }) {
  controller = useCardsSearchController({ initialUrlState });
  return null;
}

const mount = async (initialUrlState?: SearchUrlState) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<Harness initialUrlState={initialUrlState} />));
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
  // No timers advanced: a URL change must never report the old search back.
  expect(controller.queryArgs.searchQuery).toBe("colors");
  expect(controller.urlState).toEqual({
    q: "colors",
    sort: "newest",
    tag: "",
    types: [],
  });
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
