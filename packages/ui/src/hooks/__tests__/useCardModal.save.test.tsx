import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Convex is the boundary: the save writes through `updateCardField`.
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
