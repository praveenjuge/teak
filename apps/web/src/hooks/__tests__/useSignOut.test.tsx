import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let release: () => void = () => undefined;
let fail: (error: Error) => void = () => undefined;
const signOut = mock(
  () =>
    new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    })
);
mock.module("@/lib/sign-out-client", () => ({ signOut }));
const toastError = mock();
mock.module("sonner", () => ({ toast: { error: toastError } }));
mock.module("@teak/convex/shared/clientTelemetry", () => ({
  captureClientException: mock(),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSignOut } = await import("../useSignOut");

let api: ReturnType<typeof useSignOut> | undefined;
function Harness() {
  api = useSignOut();
  return null;
}
let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

test("a failed sign-out says so, and a second press while one runs does nothing", async () => {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));

  let first: Promise<void> | undefined;
  await act(() => {
    first = api?.signOut();
    // A second press while the first is still running.
    void api?.signOut();
  });
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(api?.signingOut).toBe(true);

  await act(async () => {
    fail(new Error("network"));
    await first;
  });
  expect(toastError).toHaveBeenCalledWith(
    "Failed to sign out. Please try again."
  );
  expect(api?.signingOut).toBe(false);

  // It can be tried again.
  await act(async () => {
    const again = api?.signOut();
    release();
    await again;
  });
  expect(signOut).toHaveBeenCalledTimes(2);
});
