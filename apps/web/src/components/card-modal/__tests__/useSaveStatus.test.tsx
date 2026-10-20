import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardSaveState } from "../../../hooks/useCardModal";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SLOW_SAVE_MS, useSaveStatus } = await import("../useSaveStatus");

let root: Root | undefined;
let shown: ReturnType<typeof useSaveStatus> = null;

function Harness({ state }: { state: CardSaveState }) {
  shown = useSaveStatus(state);
  return null;
}

const show = (state: CardSaveState) =>
  act(() => {
    root ??= createRoot(document.createElement("div"));
    root.render(<Harness state={state} />);
  });

const wait = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  jest.useRealTimers();
});

test("a quick save shows nothing while it saves, then Saved", async () => {
  await show("unsaved");
  expect(shown).toBeNull();
  await show("saving");
  expect(shown).toBeNull();
  await show("saved");
  expect(shown).toBe("saved");
  await show("idle");
  expect(shown).toBeNull();
});

test("a slow save shows Saving… once it has taken a second", async () => {
  await show("saving");
  await wait(SLOW_SAVE_MS - 1);
  expect(shown).toBeNull();
  await wait(1);
  expect(shown).toBe("saving");
});

test("a failure shows until the next save", async () => {
  await show("saving");
  await show("error");
  expect(shown).toBe("error");
  await wait(SLOW_SAVE_MS * 5);
  expect(shown).toBe("error");
  await show("saving");
  expect(shown).toBeNull();
});

test("the next save starts its own clock", async () => {
  await show("saving");
  await wait(SLOW_SAVE_MS);
  await show("saved");
  await show("saving");
  expect(shown).toBeNull();
});
