import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useReturnFocus } = await import("../useReturnFocus");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function renderReturnFocus() {
  let returnFocus = {} as ReturnType<typeof useReturnFocus>;
  function Harness({ open }: { open: boolean }) {
    returnFocus = useReturnFocus(open);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const setOpen = (open: boolean) =>
    act(() => root?.render(<Harness open={open} />));
  await setOpen(false);
  return { returnFocus: () => returnFocus, setOpen };
}

function button(label: string) {
  const element = document.createElement("button");
  element.textContent = label;
  document.body.append(element);
  return element;
}

test("puts focus back on what had it when the dialog opened", async () => {
  const opener = button("Opener");
  const other = button("Other");
  const { returnFocus, setOpen } = await renderReturnFocus();

  opener.focus();
  await setOpen(true);
  other.focus();
  await setOpen(false);
  const event = new Event("focusout", { cancelable: true });
  returnFocus()(event);

  expect(document.activeElement).toBe(opener);
  expect(event.defaultPrevented).toBe(true);
});

test("uses the fallback when nothing had focus on opening", async () => {
  const fallback = button("Fallback");
  const { returnFocus, setOpen } = await renderReturnFocus();

  await setOpen(true);
  await setOpen(false);
  returnFocus()(new Event("focusout", { cancelable: true }), fallback);

  expect(document.activeElement).toBe(fallback);
});

test("leaves focus to the dialog when the opener is gone", async () => {
  const opener = button("Opener");
  const { returnFocus, setOpen } = await renderReturnFocus();

  opener.focus();
  await setOpen(true);
  opener.remove();
  await setOpen(false);
  const event = new Event("focusout", { cancelable: true });
  returnFocus()(event);

  expect(event.defaultPrevented).toBe(false);
});
