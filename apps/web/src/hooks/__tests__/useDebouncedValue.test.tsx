import { afterEach, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDebouncedValue } = await import("../useDebouncedValue");

let root: Root | undefined;
let shown = "";

function Harness({ delay, value }: { delay: number; value: string }) {
  [shown] = useDebouncedValue(value, delay);
  return null;
}

const render = (value: string, delay = 200) =>
  act(() => root?.render(<Harness delay={delay} value={value} />));

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  jest.useRealTimers();
});

test("follows the value once it stops changing for the delay", async () => {
  jest.useFakeTimers();
  root = createRoot(document.createElement("div"));
  await render("a");
  await render("ab");
  await act(() => jest.advanceTimersByTime(150));
  await render("abc");
  await act(() => jest.advanceTimersByTime(150));
  expect(shown).toBe("a");
  await act(() => jest.advanceTimersByTime(50));
  expect(shown).toBe("abc");
});

test("a delay of 0 follows at once", async () => {
  root = createRoot(document.createElement("div"));
  await render("a");
  await render("", 0);
  expect(shown).toBe("");
});
