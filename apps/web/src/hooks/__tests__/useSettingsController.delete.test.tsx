import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));
mock.module("../../lib/convexQueryHooks", () => ({
  useQuery: () => undefined,
}));
mock.module("../useDeviceSessions", () => ({
  useDeviceSessions: () => ({ isCurrentIdentity: () => false }),
}));
mock.module("@teak/convex/shared/clientTelemetry", () => ({
  captureClientException: mock(),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSettingsController } = await import("../useSettingsController");

let controller: ReturnType<typeof useSettingsController> | undefined;
function Harness() {
  controller = useSettingsController({
    onDeleteAccount: () => Promise.reject(new Error("offline")),
    onOpenExternal: () => undefined,
    onSignOut: () => undefined,
  });
  return null;
}
let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

test("reopening Delete account starts without the last attempt's error", async () => {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  await act(() => controller?.setDeleteDialogOpen(true));
  await act(async () => {
    await controller?.handleDeleteAccount();
  });
  expect(controller?.deleteDialogError).toBe(
    "Something went wrong while deleting your account."
  );

  await act(() => controller?.setDeleteDialogOpen(false));
  await act(() => controller?.setDeleteDialogOpen(true));
  expect(controller?.deleteDialogError).toBeNull();
});
