import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { toast } = await import("sonner");
const { Toaster } = await import("../sonner");
const { BulkActionBar } = await import("../../selection/BulkActionBar");

let root: Root | undefined;

afterEach(async () => {
  toast.dismiss();
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function render(showBulkBar: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  root = root ?? createRoot(container);
  await act(() =>
    root?.render(
      <>
        <Toaster position="bottom-center" />
        {showBulkBar && (
          <BulkActionBar
            onAction={() => undefined}
            onCancel={() => undefined}
            selectedCount={2}
          />
        )}
      </>
    )
  );
}

// Sonner adds toasts on the next tick.
const showToast = () =>
  act(async () => {
    toast("Card deleted");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const toasterBottomOffset = () =>
  document
    .querySelector<HTMLElement>("[data-sonner-toaster]")
    ?.style.getPropertyValue("--offset-bottom");

test("keeps bottom toasts flush with the screen edge by default", async () => {
  await render(false);
  await showToast();
  expect(toasterBottomOffset()).toBe("0px");
});

// The bulk-action bar sits along the top edge, so toasts stay at the bottom.
test("keeps toasts at the bottom edge while the bulk-action bar is shown", async () => {
  await render(true);
  await showToast();
  expect(toasterBottomOffset()).toBe("0px");
});
