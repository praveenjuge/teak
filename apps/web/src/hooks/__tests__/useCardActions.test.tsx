import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Write {
  action?: string;
  cardId?: string;
  cardIds?: string[];
  field?: string;
  id?: string;
  pinned?: boolean;
}
const writes: Write[] = [];
let refuse: ((args: Write) => boolean) | null = null;
const write = (args: Write) => {
  writes.push(args);
  if (refuse?.(args)) {
    return Promise.reject(new Error("refused"));
  }
  return Promise.resolve(
    args.cardIds ? { failedIds: [], updatedIds: args.cardIds } : null
  );
};
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: () =>
    Object.assign(write, { withOptimisticUpdate: () => write }),
}));

interface ToastCall {
  action?: () => void;
  duration?: number;
  kind: "error" | "loading" | "message" | "success";
  message: string;
}
const toasts: ToastCall[] = [];
const record =
  (kind: ToastCall["kind"]) =>
  (
    message: string,
    options?: { action?: { onClick: () => void }; duration?: number }
  ) => {
    toasts.push({
      action: options?.action?.onClick,
      duration: options?.duration,
      kind,
      message,
    });
  };
mock.module("sonner", () => ({
  toast: Object.assign(record("message"), {
    error: record("error"),
    loading: record("loading"),
    success: record("success"),
  }),
}));

const events: { name: string; properties: unknown }[] = [];
const realAnalytics = await import("@teak/convex/shared/analytics");
mock.module("@teak/convex/shared/analytics", () => ({
  ...realAnalytics,
  captureEvent: (name: string, properties: unknown) => {
    events.push({ name, properties });
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardActions } = await import("../useCardActions");

let root: Root | undefined;
let actions = {} as ReturnType<typeof useCardActions>;

function Harness() {
  actions = useCardActions();
  return null;
}

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  writes.length = 0;
  toasts.length = 0;
  events.length = 0;
  refuse = null;
});

async function render() {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
}

const card = (extra: Record<string, unknown> = {}) =>
  ({
    _creationTime: 1,
    _id: "card_a",
    content: "",
    createdAt: 1,
    type: "link",
    updatedAt: 1,
    userId: "user_a",
    ...extra,
  }) as never;

const film = (extra: Record<string, unknown> = {}) =>
  card({
    metadata: {
      linkCategory: { category: "movie", fetchedAt: 1, sourceUrl: "x" },
    },
    ...extra,
  });

test("moving a card to Trash says so for 10 seconds, and Undo restores it", async () => {
  await render();
  let happened = false;
  await act(async () => {
    happened = await actions.run("moveToTrash", card());
  });
  expect(happened).toBe(true);
  expect(toasts).toMatchObject([
    { duration: 10_000, kind: "success", message: "Moved 1 card to Trash" },
  ]);
  await act(async () => {
    toasts[0]?.action?.();
    await Promise.resolve();
  });
  expect(writes.map(({ action }) => action)).toEqual(["delete", "restore"]);
});

test("a favorite sets the state it shows the opposite of, without a toast", async () => {
  await render();
  await act(async () => {
    await actions.run("favorite", card());
    await actions.run("favorite", card({ isFavorited: true }));
  });
  expect(writes.map(({ action }) => action)).toEqual([
    "favorite",
    "unfavorite",
  ]);
  expect(toasts).toEqual([]);
});

test("a card the server refuses says so, and Retry tries it again", async () => {
  await render();
  refuse = () => true;
  let happened = true;
  await act(async () => {
    happened = await actions.run("archive", card());
  });
  expect(happened).toBe(false);
  expect(toasts).toMatchObject([
    { kind: "error", message: "Couldn't archive these cards" },
  ]);
  refuse = null;
  await act(async () => {
    toasts[0]?.action?.();
    await Promise.resolve();
  });
  expect(writes.map(({ action }) => action)).toEqual(["archive", "archive"]);
});

test("marking a film done says Marked as watched, and Undo unmarks it", async () => {
  await render();
  await act(async () => {
    await actions.run("done", film());
  });
  expect(writes).toMatchObject([{ cardId: "card_a", field: "done" }]);
  expect(toasts).toMatchObject([
    { duration: 10_000, kind: "success", message: "Marked as watched" },
  ]);
  expect(events).toEqual([
    {
      name: "card_done_toggled",
      properties: { category: "movie", done: true, source: "panel" },
    },
  ]);
  await act(async () => {
    toasts[0]?.action?.();
    await Promise.resolve();
  });
  expect(writes.at(-1)).toMatchObject({ field: "undone" });
  expect(toasts).toHaveLength(1);
});

test("a done mark the server refuses says so", async () => {
  await render();
  refuse = () => true;
  await act(async () => {
    await actions.run("done", film({ completedAt: 5 }));
  });
  expect(writes).toMatchObject([{ field: "undone" }]);
  expect(toasts).toMatchObject([
    { kind: "error", message: "Couldn't update. Try again." },
  ]);
  expect(events).toEqual([]);
});

test("a pin from a surface the catalog names is counted, any other isn't", async () => {
  await render();
  await act(async () => {
    await actions.run("pin", card(), "dialog");
    await actions.togglePin(card({ pinPosition: 1 }));
  });
  expect(writes).toMatchObject([
    { cardId: "card_a", pinned: true },
    { cardId: "card_a", pinned: false },
  ]);
  expect(events).toEqual([
    {
      name: "card_pin_toggled",
      properties: { pinned: true, source: "dialog" },
    },
  ]);
});

test("deleting cards forever counts them in one toast, and names a failure", async () => {
  await render();
  refuse = (args) => args.id === "card_b";
  let result = { deletedCount: 0, failedIds: [] as string[] };
  await act(async () => {
    result = await actions.deleteForever(["card_a", "card_b", "card_c"]);
  });
  expect(result.deletedCount).toBe(2);
  expect(result.failedIds).toEqual(["card_b"]);
  expect(toasts).toMatchObject([
    { kind: "message", message: "2 cards permanently deleted" },
    { kind: "error", message: "Failed to permanently delete card" },
  ]);
});
