import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let write = mock(async (_args: unknown) => null as unknown);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => ({}),
  useMutation: () =>
    Object.assign((args: unknown) => write(args), {
      withOptimisticUpdate: () => (args: unknown) => write(args),
    }),
}));
const toasts: { kind: string; message: string; undo?: () => void }[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (message: string) => {
      toasts.push({ kind: "error", message });
    },
    success: (
      message: string,
      options?: { action?: { onClick: () => void } }
    ) => {
      toasts.push({
        kind: "success",
        message,
        undo: options?.action?.onClick,
      });
    },
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardModal } = await import("../useCardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  toasts.length = 0;
});

const note = (extra: Record<string, unknown> = {}) =>
  ({
    _creationTime: 1,
    _id: "card_a",
    aiTags: ["botany", "macro"],
    content: "Lily",
    createdAt: 1,
    tags: ["flowers"],
    type: "text",
    updatedAt: 1,
    userId: "user_a",
    ...extra,
  }) as never;

let hook = {} as ReturnType<typeof useCardModal>;
function Harness({ card }: { card: { _id: string } }) {
  hook = useCardModal(card._id, { card: card as never });
  return null;
}

async function renderHook(card: unknown) {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness card={card as never} />));
  return () => hook;
}

test("deleting says Card deleted, and its Undo restores the card", async () => {
  write = mock(async () => null);
  const hook = await renderHook(note());
  const closed = mock();
  await act(() => hook().handleDelete(closed));
  expect(write.mock.calls[0]?.[0]).toEqual({
    cardId: "card_a",
    field: "delete",
  });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(toasts).toMatchObject([{ kind: "success", message: "Card deleted" }]);

  await act(async () => {
    toasts[0]?.undo?.();
    await Promise.resolve();
  });
  expect(write.mock.calls[1]?.[0]).toEqual({
    cardId: "card_a",
    field: "restore",
  });
});

test("an Undo that fails to restore says so", async () => {
  write = mock((args: unknown) =>
    (args as { field: string }).field === "restore"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(null)
  );
  const hook = await renderHook(note());
  await act(() => hook().handleDelete());
  await act(async () => {
    toasts[0]?.undo?.();
    await Promise.resolve();
  });
  expect(toasts.at(-1)).toEqual({
    kind: "error",
    message: "Failed to restore card",
  });
});

test("keeping a suggested tag adds it to the card's own tags", async () => {
  write = mock(async () => null);
  const hook = await renderHook(note());
  await act(async () => {
    hook().acceptAiTag("macro");
    await Promise.resolve();
  });
  expect(write.mock.calls[0]?.[0]).toMatchObject({
    cardId: "card_a",
    field: "tags",
    value: ["flowers", "macro"],
  });
});

test("keeping a tag the card already has writes nothing", async () => {
  write = mock(async () => null);
  const hook = await renderHook(note({ tags: ["macro"] }));
  await act(async () => {
    hook().acceptAiTag("macro");
    await Promise.resolve();
  });
  expect(write).not.toHaveBeenCalled();
});

test("pressing Delete twice deletes the card once", async () => {
  let finish = () => undefined as unknown;
  write = mock(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(null);
      })
  );
  const hook = await renderHook(note());
  const closed = mock();
  let first: Promise<void> | undefined;
  await act(() => {
    first = hook().handleDelete(closed);
  });
  await act(() => hook().handleDelete(closed));
  await act(async () => {
    finish();
    await first;
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
});

test("a card stepped to while another's delete runs can still be deleted", async () => {
  const pending: (() => void)[] = [];
  write = mock(
    () => new Promise((resolve) => pending.push(() => resolve(null)))
  );
  const hook = await renderHook(note());
  let first: Promise<void> | undefined;
  await act(() => {
    first = hook().handleDelete();
  });
  await act(() =>
    root?.render(<Harness card={note({ _id: "card_b" }) as never} />)
  );
  let second: Promise<void> | undefined;
  await act(() => {
    second = hook().handleDelete();
  });
  await act(async () => {
    for (const resolve of pending) {
      resolve();
    }
    await Promise.all([first, second]);
  });
  expect(write.mock.calls.map(([args]) => args)).toEqual([
    { cardId: "card_a", field: "delete" },
    { cardId: "card_b", field: "delete" },
  ]);
});
