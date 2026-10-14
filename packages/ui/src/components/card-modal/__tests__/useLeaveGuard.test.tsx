import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useLeaveGuard } = await import("../useLeaveGuard");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

async function renderGuard(
  saveChanges: (options: { silent: boolean }) => Promise<boolean>,
  hasUnsavedChanges = true
) {
  let guard = {} as ReturnType<typeof useLeaveGuard>;
  function Harness() {
    guard = useLeaveGuard({ cardId: "card_a", hasUnsavedChanges, saveChanges });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return () => guard;
}

const leave = async (guard: () => ReturnType<typeof useLeaveGuard>) => {
  let ready: boolean | undefined;
  await act(async () => {
    ready = await guard().readyToLeave();
  });
  return ready;
};

test("leaves at once with nothing to save", async () => {
  const save = mock(() => Promise.resolve(true));
  const guard = await renderGuard(save, false);
  expect(await leave(guard)).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

test("saves before leaving, and leaves once the save works", async () => {
  const save = mock(() => Promise.resolve(true));
  const guard = await renderGuard(save);
  expect(await leave(guard)).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
});

test("an earlier failed autosave doesn't skip the save on the first close", async () => {
  // The autosave failed before this; the guard never saw it. The first
  // close must still try to save, and stay open when that fails too.
  const save = mock(() => Promise.resolve(false));
  const guard = await renderGuard(save);
  expect(await leave(guard)).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
});

test("a second close after a failed save leaves, so no error traps the card", async () => {
  const save = mock(() => Promise.resolve(false));
  const guard = await renderGuard(save);
  expect(await leave(guard)).toBe(false);
  expect(await leave(guard)).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
});

test("editing again after a failed save saves again before leaving", async () => {
  const save = mock(() => Promise.resolve(false));
  const guard = await renderGuard(save);
  expect(await leave(guard)).toBe(false);
  await act(() => guard().noteEdit());
  expect(await leave(guard)).toBe(false);
  expect(save).toHaveBeenCalledTimes(2);
});
