import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Dialog, DialogContent, DialogTitle } = await import("../dialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderOpenDialog(onOpenChange: (open: boolean) => void) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <>
        <section data-sonner-toaster="">
          <button type="button">Undo</button>
        </section>
        <p>Behind the dialog</p>
        <Dialog onOpenChange={onOpenChange} open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>A card</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    )
  );
  // Radix starts listening for outside presses on the next tick.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

const press = (element: Element) =>
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 })
    );
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

test("pressing a toast's Undo leaves the dialog open", async () => {
  const onOpenChange = mock();
  await renderOpenDialog(onOpenChange);
  const undo = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Undo"
  );
  await press(undo as Element);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("pressing the page behind it still closes the dialog", async () => {
  const onOpenChange = mock();
  await renderOpenDialog(onOpenChange);
  const behind = Array.from(document.querySelectorAll("p")).find(
    (p) => p.textContent === "Behind the dialog"
  );
  await press(behind as Element);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
