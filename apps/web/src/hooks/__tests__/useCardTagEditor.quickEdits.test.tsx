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
const { useCardTagEditor } = await import("../useCardTagEditor");

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
  let hook = {} as ReturnType<typeof useCardTagEditor>;
  function Harness() {
    hook = useCardTagEditor(card as never);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return () => hook;
}

test("removing two tags before the card catches up removes both", async () => {
  const hook = await renderHook({ ...baseCard, tags: ["a", "b", "c"] });
  await act(() => hook().removeTag("c"));
  await act(() => hook().removeTag("b"));
  expect(writes.map((entry) => entry.value)).toEqual([["a", "b"], ["a"]]);
});

test("adding two tags before the card catches up keeps both", async () => {
  const hook = await renderHook({ ...baseCard, tags: [] });
  await act(() => hook().setInput("first"));
  await act(() => hook().addTag());
  await act(() => hook().setInput("second"));
  await act(() => hook().addTag());
  expect(writes.map((entry) => entry.value)).toEqual([
    ["first"],
    ["first", "second"],
  ]);
});

test("a tag the card already has, in any case, clears the field and says so", async () => {
  const hook = await renderHook({ ...baseCard, tags: ["Design"] });
  await act(() => hook().setInput("  design "));
  await act(() => hook().addTag());
  expect(writes).toEqual([]);
  expect(hook().input).toBe("");
  expect(notices).toEqual(["Already tagged #Design"]);
});

test("keeping a suggested tag adds it to the card's own tags", async () => {
  const hook = await renderHook({
    ...baseCard,
    aiTags: ["botany", "macro"],
    tags: ["flowers"],
  });
  await act(async () => {
    hook().acceptAiTag("macro");
    await Promise.resolve();
  });
  expect(writes[0]).toMatchObject({
    cardId: "card_a",
    field: "tags",
    value: ["flowers", "macro"],
  });
});

test("keeping a tag the card already has writes nothing", async () => {
  const hook = await renderHook({
    ...baseCard,
    aiTags: ["macro"],
    tags: ["macro"],
  });
  await act(async () => {
    hook().acceptAiTag("macro");
    await Promise.resolve();
  });
  expect(writes).toEqual([]);
});
