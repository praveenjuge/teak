import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));
mock.module("../../../lib/convexQueryHooks", () => ({
  useQuery: () => ({ canCreateCard: true }),
}));
mock.module("@/hooks", () => ({
  useGlobalFileDrop: () => ({
    enqueueFiles: mock(),
    isUploading: false,
    queueSize: 0,
  }),
}));
mock.module("@/hooks/useFileUploadCore", () => ({
  useFileUploadCore: () => ({ uploadFile: mock() }),
}));
mock.module("../../shortcuts/ShortcutTooltip", () => ({
  ShortcutTooltip: ({ children }: { children: ReactNode }) => children,
}));
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
    open,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) =>
    open ? (
      <div data-dialog="">
        <button onClick={() => onOpenChange(false)} type="button">
          Dismiss
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AddCardActions } = await import("../AddCardActions");

let root: Root | undefined;
let grantMicrophone: (() => void) | undefined;
let denyMicrophone: (() => void) | undefined;
const stopTrack = mock();
const recorderStarts = mock();

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  ondataavailable: unknown = null;
  onstop: unknown = null;
  start = recorderStarts;
  stop = mock();
}

beforeEach(async () => {
  stopTrack.mockClear();
  recorderStarts.mockClear();
  Object.assign(globalThis, { MediaRecorder: FakeMediaRecorder });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((resolve, reject) => {
          grantMicrophone = () =>
            resolve({ getTracks: () => [{ stop: stopTrack }] });
          denyMicrophone = () =>
            reject(new DOMException("Denied", "NotAllowedError"));
        }),
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<AddCardActions />));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent === name
  ) as HTMLButtonElement;

test("closing the dialog while the microphone prompt is open never starts a recording", async () => {
  await act(async () => button("Record audio").click());
  await act(async () => button("Dismiss").click());
  await act(async () => grantMicrophone?.());

  expect(recorderStarts).not.toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(button("Record audio").disabled).toBe(false);
  expect(document.querySelector("[data-dialog]")).toBeNull();
});

test("granting the microphone with the dialog open starts recording", async () => {
  await act(async () => button("Record audio").click());
  await act(async () => grantMicrophone?.());

  expect(recorderStarts).toHaveBeenCalledTimes(1);
  expect(stopTrack).not.toHaveBeenCalled();
});

test("a closed start that fails later leaves the next recording running", async () => {
  await act(async () => button("Record audio").click());
  const denyFirst = denyMicrophone;
  await act(async () => button("Dismiss").click());
  await act(async () => button("Record audio").click());
  await act(async () => grantMicrophone?.());
  await act(async () => denyFirst?.());

  expect(recorderStarts).toHaveBeenCalledTimes(1);
  expect(stopTrack).not.toHaveBeenCalled();
  expect(document.querySelector("[data-dialog]")).not.toBeNull();
});
