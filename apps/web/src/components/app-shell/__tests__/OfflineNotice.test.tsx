import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const warning = mock();
const dismiss = mock();
mock.module("sonner", () => ({ toast: { dismiss, warning } }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { OfflineNotice } = await import("../OfflineNotice");

let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

test("going offline says changes will save on reconnecting, and coming back clears it", async () => {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<OfflineNotice />));
  expect(warning).not.toHaveBeenCalled();

  await act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(warning).toHaveBeenCalledWith(
    "You're offline. Changes will save when you reconnect.",
    { duration: Number.POSITIVE_INFINITY, id: "offline" }
  );

  dismiss.mockClear();
  await act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(dismiss).toHaveBeenCalledWith("offline");
});
