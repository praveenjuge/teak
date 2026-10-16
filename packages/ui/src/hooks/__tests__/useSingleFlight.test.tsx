import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSingleFlight } = await import("../useSingleFlight");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

async function renderSingleFlight(action: (value: string) => Promise<void>) {
  let current = {} as ReturnType<typeof useSingleFlight<[string]>>;
  function Harness() {
    current = useSingleFlight(action);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return () => current;
}

const deferred = () => {
  const settle: { reject?: (error: Error) => void; resolve?: () => void } = {};
  const promise = new Promise<void>((resolve, reject) => {
    settle.resolve = resolve;
    settle.reject = reject;
  });
  return {
    promise,
    reject: (error: Error) => settle.reject?.(error),
    resolve: () => settle.resolve?.(),
  };
};

test("ignores a second call while the first is in flight", async () => {
  const pending = deferred();
  const action = mock((_value: string) => pending.promise);
  const flight = await renderSingleFlight(action);
  const [run] = flight();

  let first: Promise<void> | undefined;
  await act(() => {
    first = run("a");
    run("b").catch(() => undefined);
  });
  expect(action).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenCalledWith("a");
  expect(flight()[1]).toBe(true);

  await act(async () => {
    pending.resolve();
    await first;
  });
  expect(flight()[1]).toBe(false);
});

test("runs again once a run has failed", async () => {
  const pending = deferred();
  const action = mock((_value: string) => pending.promise);
  const flight = await renderSingleFlight(action);

  let first: Promise<void> | undefined;
  await act(() => {
    first = flight()[0]("a");
  });
  await act(async () => {
    pending.reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
  });
  expect(flight()[1]).toBe(false);

  action.mockImplementation(() => Promise.resolve());
  await act(() => flight()[0]("b"));
  expect(action).toHaveBeenCalledTimes(2);
  expect(action).toHaveBeenLastCalledWith("b");
});
