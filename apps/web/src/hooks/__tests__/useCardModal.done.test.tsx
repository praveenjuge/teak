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

const filmLink = (completedAt?: number, id = "card_a") =>
  ({
    _creationTime: 1,
    _id: id,
    completedAt,
    content: "https://example.com/film",
    createdAt: 1,
    metadata: {
      linkCategory: {
        category: "movie",
        fetchedAt: 1,
        sourceUrl: "https://example.com/film",
      },
    },
    tags: [],
    type: "link",
    updatedAt: 1,
    url: "https://example.com/film",
    userId: "user_a",
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

const showCard = (card: unknown) =>
  act(() => root?.render(<Harness card={card as never} />));

test("marking a film done writes it, says Marked as watched, and Undo unmarks it", async () => {
  write = mock(async () => null);
  const hook = await renderHook(filmLink());
  await act(async () => {
    hook().toggleDone();
    await Promise.resolve();
  });
  expect(write.mock.calls[0]?.[0]).toEqual({
    cardId: "card_a",
    field: "done",
  });
  expect(toasts).toMatchObject([
    { kind: "success", message: "Marked as watched" },
  ]);

  await act(async () => {
    toasts[0]?.undo?.();
    await Promise.resolve();
  });
  expect(write.mock.calls[1]?.[0]).toEqual({
    cardId: "card_a",
    field: "undone",
  });
  expect(toasts).toHaveLength(1);
});

test("the toggle shows done at once, and a failed write puts it back", async () => {
  let fail: (error: Error) => void = () => undefined;
  write = mock(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  const hook = await renderHook(filmLink());
  await act(() => {
    hook().toggleDone();
  });
  expect(hook().card?.completedAt).toEqual(expect.any(Number));

  await act(async () => {
    fail(new Error("offline"));
    await Promise.resolve();
  });
  expect(hook().card?.completedAt).toBeUndefined();
  expect(toasts).toEqual([
    { kind: "error", message: "Couldn't update. Try again." },
  ]);
});

test("a second click while the first is still saving does nothing", async () => {
  let finish: () => void = () => undefined;
  write = mock(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(null);
      })
  );
  const hook = await renderHook(filmLink(5));
  await act(() => {
    hook().toggleDone();
  });
  await act(() => {
    hook().toggleDone();
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]?.[0]).toMatchObject({ field: "undone" });
  await act(async () => {
    finish();
    await Promise.resolve();
  });
  expect(toasts).toMatchObject([{ message: "Marked as not watched" }]);
});

test("a note can't be marked done", async () => {
  write = mock(async () => null);
  const hook = await renderHook({
    _creationTime: 1,
    _id: "card_a",
    content: "A note",
    createdAt: 1,
    tags: [],
    type: "text",
    updatedAt: 1,
    userId: "user_a",
  });
  await act(() => {
    hook().toggleDone();
  });
  expect(write).not.toHaveBeenCalled();
});

test("a write still saving for one card doesn't show on, or block, the next card", async () => {
  const finishes: (() => void)[] = [];
  write = mock(
    () =>
      new Promise((resolve) => {
        finishes.push(() => resolve(null));
      })
  );
  const hook = await renderHook(filmLink());
  await act(() => {
    hook().toggleDone();
  });
  await showCard(filmLink(undefined, "card_b"));
  expect(hook().card?.completedAt).toBeUndefined();

  await act(() => {
    hook().toggleDone();
  });
  expect(write.mock.calls.map(([args]) => args)).toEqual([
    { cardId: "card_a", field: "done" },
    { cardId: "card_b", field: "done" },
  ]);
  expect(hook().card?.completedAt).toEqual(expect.any(Number));
  await act(async () => {
    for (const finish of finishes) {
      finish();
    }
    await Promise.resolve();
  });
});
