import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { Root } from "react-dom/client";

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

function Harness() {
  controller = useCardsSearchController();
  return null;
}

const card = (id: string, content: string): Doc<"cards"> =>
  ({
    _creationTime: 1,
    _id: id as Id<"cards">,
    content,
    createdAt: 1,
    type: "text",
    updatedAt: 1,
    userId: "user-1",
  }) as Doc<"cards">;

const remoteKey = () => JSON.stringify(controller.queryArgs);
const displayedIds = () => controller.displayCards.map((c) => c._id);

beforeEach(async () => {
  jest.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<Harness />));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  jest.useRealTimers();
});

test("waits for typing to pause before changing the remote search query", async () => {
  for (const value of ["d", "de", "des"]) {
    await act(() => controller.searchBarProps.onSearchChange(value));
    await act(() => jest.advanceTimersByTime(100));
  }
  expect(controller.queryArgs.searchQuery).toBeUndefined();
  expect(controller.isSearchPending).toBe(true);

  await act(() => jest.advanceTimersByTime(99));
  expect(controller.queryArgs.searchQuery).toBeUndefined();

  await act(() => jest.advanceTimersByTime(1));
  expect(controller.queryArgs.searchQuery).toBe("des");
  expect(controller.isSearchPending).toBe(false);
});

test("clears the remote search query immediately when the input is emptied", async () => {
  await act(() => controller.searchBarProps.onSearchChange("design"));
  await act(() => jest.advanceTimersByTime(200));
  expect(controller.queryArgs.searchQuery).toBe("design");

  await act(() => controller.searchBarProps.onSearchChange(""));
  expect(controller.queryArgs.searchQuery).toBeUndefined();
});

test("shows local matches instantly while the remote query is debounced", async () => {
  await act(() =>
    controller.setRemoteCards([card("a", "design"), card("b", "other")])
  );
  await act(() => controller.searchBarProps.onSearchChange("desi"));
  expect(displayedIds()).toEqual(["a"]);
});

test("removes a card deleted on another client from active search results", async () => {
  await act(() => controller.addKeywordTag("design"));
  const key = remoteKey();
  await act(() =>
    controller.setRemoteCards(
      [card("kept", "design one"), card("gone", "design two")],
      key
    )
  );
  expect(displayedIds().sort()).toEqual(["gone", "kept"]);

  // The reactive search drops the card once it is deleted elsewhere.
  await act(() =>
    controller.setRemoteCards([card("kept", "design one")], remoteKey())
  );
  expect(displayedIds()).toEqual(["kept"]);
});
