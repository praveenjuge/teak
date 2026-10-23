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
mock.module("sonner", () => ({
  toast: { error: () => undefined, success: () => undefined },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardModal } = await import("../useCardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

const card = {
  _creationTime: 1,
  _id: "card_a",
  content: "Hello",
  createdAt: 1,
  notes: "Old note",
  type: "text",
  updatedAt: 1,
  userId: "user_a",
} as never;

async function renderHook() {
  let hook = {} as ReturnType<typeof useCardModal>;
  function Harness() {
    hook = useCardModal("card_a", { card });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return () => hook;
}

test("a save with nothing to write succeeds", async () => {
  write = mock(async () => null);
  const hook = await renderHook();
  await expect(hook().saveChanges({ silent: true })).resolves.toBe(true);
  expect(write).not.toHaveBeenCalled();
});

test("a failed write reports failure and keeps the edit unsaved", async () => {
  write = mock(() => Promise.reject(new Error("offline")));
  const logError = console.error;
  console.error = () => undefined;
  const hook = await renderHook();
  await act(() => hook().updateNotes("New note"));
  let saved: boolean | undefined;
  await act(async () => {
    saved = await hook().saveChanges({ silent: true });
  });
  console.error = logError;
  expect(saved).toBe(false);
  expect(hook().hasUnsavedChanges).toBe(true);
  expect(hook().saveState).toBe("error");
  expect(hook().getCurrentValue("notes")).toBe("New note");
});

test("a successful write reports success", async () => {
  write = mock(async () => null);
  const hook = await renderHook();
  await act(() => hook().updateNotes("New note"));
  let saved: boolean | undefined;
  await act(async () => {
    saved = await hook().saveChanges({ silent: true });
  });
  expect(saved).toBe(true);
  expect(write).toHaveBeenCalledWith({
    cardId: "card_a",
    field: "notes",
    value: "New note",
  });
});

const cardB = {
  _creationTime: 2,
  _id: "card_b",
  content: "Other",
  createdAt: 2,
  type: "text",
  updatedAt: 2,
  userId: "user_a",
} as never;

async function renderSwitchable() {
  let hook = {} as ReturnType<typeof useCardModal>;
  let open: { id: string; card: never } = { id: "card_a", card };
  function Harness() {
    hook = useCardModal(open.id, { card: open.card });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return {
    hook: () => hook,
    openCardB: () => {
      open = { id: "card_b", card: cardB };
      return act(() => root?.render(<Harness />));
    },
  };
}

test("moving to another card sends the edit it hadn't saved yet", async () => {
  write = mock(async () => null);
  const { hook, openCardB } = await renderSwitchable();
  await act(() => hook().updateNotes("Typed, then a tag was clicked"));

  await openCardB();

  expect(write).toHaveBeenCalledWith({
    cardId: "card_a",
    field: "notes",
    value: "Typed, then a tag was clicked",
  });
  expect(hook().hasUnsavedChanges).toBe(false);
});

test("closing the dialog sends the edit it hadn't saved yet", async () => {
  write = mock(async () => null);
  const { hook } = await renderSwitchable();
  await act(() => hook().updateNotes("Typed, then Back"));

  await act(() => root?.unmount());
  root = undefined;

  expect(write).toHaveBeenCalledWith({
    cardId: "card_a",
    field: "notes",
    value: "Typed, then Back",
  });
});

test("a save that fails after moving on leaves the new card's state alone", async () => {
  const rejects: ((error: Error) => void)[] = [];
  write = mock(
    () =>
      new Promise((_resolve, reject) => {
        rejects.push(reject);
      })
  );
  const logError = console.error;
  console.error = () => undefined;
  const { hook, openCardB } = await renderSwitchable();
  await act(() => hook().updateNotes("New note"));
  let saved: Promise<boolean> | undefined;
  await act(() => {
    saved = hook().saveChanges({ silent: true });
  });

  await openCardB();
  await act(async () => {
    for (const reject of rejects) {
      reject(new Error("offline"));
    }
    await saved;
  });
  console.error = logError;

  expect(hook().saveState).not.toBe("error");
});

test("leaving sends every edited field even when one is refused", async () => {
  write = mock((args: { field: string }) =>
    args.field === "content"
      ? Promise.reject(new Error("refused"))
      : Promise.resolve(null)
  ) as typeof write;
  const { hook, openCardB } = await renderSwitchable();
  await act(() => {
    hook().updateContent("Hello there");
    hook().updateNotes("Kept note");
  });

  await openCardB();
  await act(() => Promise.resolve());

  expect(write).toHaveBeenCalledWith({
    cardId: "card_a",
    field: "notes",
    value: "Kept note",
  });
});

test("a save finishing for a card left behind keeps the open card's save going", async () => {
  const pending: (() => void)[] = [];
  write = mock(
    () => new Promise((resolve) => pending.push(() => resolve(null)))
  );
  const { hook, openCardB } = await renderSwitchable();
  await act(() => hook().updateNotes("A's note"));
  let savedA: Promise<boolean> | undefined;
  await act(() => {
    savedA = hook().saveChanges({ silent: true });
  });
  await openCardB();
  await act(() => hook().updateNotes("B's note"));
  await act(() => {
    void hook().saveChanges({ silent: true });
  });

  await act(async () => {
    pending[0]?.();
    await savedA;
  });

  expect(hook().saveState).toBe("saving");
});
