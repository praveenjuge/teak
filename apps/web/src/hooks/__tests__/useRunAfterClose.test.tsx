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

async function render(returnFocus?: (event: Event) => void) {
  function Harness() {
    hook = useRunAfterClose(returnFocus);
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root?.render(<Harness />));
}

const closing = () => new Event("focusOutside", { cancelable: true });

test("runs what was queued once the overlay closes, in place of its focus", async () => {
  const returnFocus = mock();
  await render(returnFocus);
  const action = mock();
  hook.runAfterClose(action);
  const event = closing();
  hook.onCloseAutoFocus(event);
  expect(action).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
  expect(returnFocus).not.toHaveBeenCalled();
});

test("runs it once: the next close gives focus back as usual", async () => {
  const returnFocus = mock();
  await render(returnFocus);
  const action = mock();
  hook.runAfterClose(action);
  hook.onCloseAutoFocus(closing());
  const event = closing();
  hook.onCloseAutoFocus(event);
  expect(action).toHaveBeenCalledTimes(1);
  expect(returnFocus).toHaveBeenCalledWith(event);
});

test("with nothing queued and no return target, leaves the overlay's own focus alone", async () => {
  await render();
  const event = closing();
  hook.onCloseAutoFocus(event);
  expect(event.defaultPrevented).toBe(false);
});
