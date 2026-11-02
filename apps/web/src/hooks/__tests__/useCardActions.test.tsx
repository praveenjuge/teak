import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName } from "convex/server";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const card = {
  _creationTime: 1,
  _id: "card-1" as Id<"cards">,
  content: "a note",
  createdAt: 1,
  type: "text",
  updatedAt: 1,
  userId: "user-1",
} as Doc<"cards">;

let grid: Doc<"cards">[] = [];
const localStore = {
  getAllQueries: (query: unknown) =>
    getFunctionName(query as typeof api.cards.searchCards) ===
    getFunctionName(api.cards.searchCards)
      ? [{ args: {}, value: grid }]
      : [],
  getQuery: () => undefined,
  setQuery: (_query: unknown, _args: unknown, value: Doc<"cards">[]) => {
    grid = value;
  },
} as unknown as OptimisticLocalStore;

let serverFails = false;
let optimisticRuns = 0;
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: () => {
    const send = () =>
      serverFails ? Promise.reject(new Error("offline")) : Promise.resolve();
    return Object.assign(send, {
      withOptimisticUpdate:
        (update: (store: OptimisticLocalStore, args: unknown) => void) =>
        (args: unknown) => {
          // Convex applies the update inside the call, then replays it on
          // the server's copy as results arrive.
          const serverCopy = grid;
          update(localStore, args);
          grid = serverCopy;
          update(localStore, args);
          optimisticRuns += 2;
          return send();
        },
    });
  },
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: () => undefined,
    success: () => undefined,
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardActions } = await import("../useCardActions");

let root: Root | undefined;
let actions = {} as ReturnType<typeof useCardActions>;
const cacheUpdates: Doc<"cards">[] = [];

function Harness() {
  actions = useCardActions({
    onCardUpdate: (updated) => cacheUpdates.push(updated),
  });
  return null;
}

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  cacheUpdates.length = 0;
  serverFails = false;
  optimisticRuns = 0;
});

async function render() {
  grid = [card];
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
}

test("a hidden tag from the grid hides the card at once and tells the page's cache once", async () => {
  await render();
  await act(() => actions.updateField(card._id, "tags", ["secret"]));
  expect(optimisticRuns).toBe(2);
  expect(grid).toEqual([]);
  expect(cacheUpdates).toHaveLength(1);
  expect(cacheUpdates[0]).toMatchObject({ _id: card._id, isHidden: true });
});

test("a favorite the server refuses puts the page's cached card back", async () => {
  await render();
  serverFails = true;
  await act(async () => {
    await actions.updateField(card._id, "isFavorited");
  });
  expect(cacheUpdates.map((update) => update.isFavorited)).toEqual([
    true,
    undefined,
  ]);
});
