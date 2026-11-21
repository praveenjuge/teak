import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRunAfterClose } = await import("../useRunAfterClose");

let root: Root | undefined;
let hook = {} as ReturnType<typeof useRunAfterClose>;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

async function render(returnFocus?: () => HTMLElement | boolean) {
  function Harness() {
    hook = useRunAfterClose(returnFocus);
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root?.render(<Harness />));
}

test("runs what was queued once the overlay closes, in place of its focus", async () => {
  const returnFocus = mock(() => true);
  await render(returnFocus);
  const action = mock();
  hook.runAfterClose(action);
  expect(hook.finalFocus()).toBe(false);
  expect(action).toHaveBeenCalledTimes(1);
  expect(returnFocus).not.toHaveBeenCalled();
});

test("runs it once: the next close gives focus back as usual", async () => {
  const target = document.createElement("button");
  const returnFocus = mock(() => target);
  await render(returnFocus);
  const action = mock();
  hook.runAfterClose(action);
  hook.finalFocus();
  expect(hook.finalFocus()).toBe(target);
  expect(action).toHaveBeenCalledTimes(1);
  expect(returnFocus).toHaveBeenCalledTimes(1);
});

test("with nothing queued and no return target, leaves the overlay's own focus alone", async () => {
  await render();
  expect(hook.finalFocus()).toBe(true);
});
