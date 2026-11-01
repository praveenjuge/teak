import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Write {
  field: string;
  value?: unknown;
}
const writes: Write[] = [];
const settles: Array<() => void> = [];
const realConvexReact = await import("convex/react");
const write = (args: unknown) => {
  writes.push(args as Write);
  return new Promise<null>((resolve) => settles.push(() => resolve(null)));
};
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => ({}),
  useMutation: () =>
    Object.assign(write, { withOptimisticUpdate: () => write }),
}));
const notices: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((message: string) => notices.push(message), {
    error: (message: string) => notices.push(message),
    success: () => undefined,
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardModal } = await import("../useCardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  writes.length = 0;
  settles.length = 0;
  notices.length = 0;
});

const baseCard = {
  _creationTime: 1,
  _id: "card_a",
  content: "Hello",
  createdAt: 1,
  type: "text",
  updatedAt: 1,
  userId: "user_a",
};

async function renderHook(card: Record<string, unknown>) {
  let hook = {} as ReturnType<typeof useCardModal>;
  function Harness() {
    hook = useCardModal("card_a", { card: card as never });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return () => hook;
}

const settleAll = () =>
  act(async () => {
    for (const settle of settles.splice(0)) {
      settle();
    }
    await Promise.resolve();
  });

test("removing two tags before the card catches up removes both", async () => {
  const hook = await renderHook({ ...baseCard, tags: ["a", "b", "c"] });
  await act(() => hook().removeTag("c"));
  await act(() => hook().removeTag("b"));
  expect(writes.map((entry) => entry.value)).toEqual([["a", "b"], ["a"]]);
});

test("adding two tags before the card catches up keeps both", async () => {
  const hook = await renderHook({ ...baseCard, tags: [] });
  await act(() => hook().setTagInput("first"));
  await act(() => hook().addTag());
  await act(() => hook().setTagInput("second"));
  await act(() => hook().addTag());
  expect(writes.map((entry) => entry.value)).toEqual([
    ["first"],
    ["first", "second"],
  ]);
});

test("a tag the card already has, in any case, clears the field and says so", async () => {
  const hook = await renderHook({ ...baseCard, tags: ["Design"] });
  await act(() => hook().setTagInput("  design "));
  await act(() => hook().addTag());
  expect(writes).toEqual([]);
  expect(hook().tagInput).toBe("");
  expect(notices).toEqual(["Already tagged #Design"]);
});

test("pressing favorite twice quickly shows the second press until both land", async () => {
  const hook = await renderHook({ ...baseCard, isFavorited: false });
  await act(() => hook().toggleFavorite());
  expect(hook().card?.isFavorited).toBe(true);
  await act(() => hook().toggleFavorite());
  expect(hook().card?.isFavorited).toBe(false);

  await act(async () => {
    settles.shift()?.();
    await Promise.resolve();
  });
  expect(hook().card?.isFavorited).toBe(false);
  expect(writes.map((entry) => entry.field)).toEqual([
    "isFavorited",
    "isFavorited",
  ]);
  await settleAll();
});

test("an emptied note isn't saved, and the card keeps its text", async () => {
  const hook = await renderHook({ ...baseCard, tags: [] });
  await act(() => hook().updateContent(" \n "));
  expect(hook().hasUnsavedChanges).toBe(false);
  await act(async () => {
    await hook().saveChanges({ silent: true });
  });
  expect(writes).toEqual([]);
});

test("a note with text still saves", async () => {
  const hook = await renderHook({ ...baseCard, tags: [] });
  await act(() => hook().updateContent("Hello there"));
  expect(hook().hasUnsavedChanges).toBe(true);
  const saving = act(async () => {
    await hook().saveChanges({ silent: true });
  });
  await settleAll();
  await saving;
  expect(writes).toEqual([
    { cardId: "card_a", field: "content", value: "Hello there" } as Write,
  ]);
});
