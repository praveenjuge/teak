import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
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
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-dialog="">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
// Render the New menu open, so its items can be read.
mock.module("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button
      disabled={disabled}
      onClick={() => onSelect?.()}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
  ),
  DropdownMenuShortcut: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <kbd className={className}>{children}</kbd>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AddCardButton, AddCardProvider } = await import("../AddCardActions");
const { pressRecordAudio, pressUploadFiles } = await import(
  "../../../lib/keyboardShortcuts"
);

let root: Root | undefined;
const recorderStarts = mock();
const pickerOpens = mock();
const realClick = HTMLInputElement.prototype.click;

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  ondataavailable: unknown = null;
  onstop: unknown = null;
  start = recorderStarts;
  state = "recording";
  stop() {
    this.state = "inactive";
  }
}

beforeEach(() => {
  recorderStarts.mockClear();
  pickerOpens.mockClear();
  HTMLInputElement.prototype.click = function click(this: HTMLInputElement) {
    if (this.type === "file") {
      pickerOpens();
    }
  };
  Object.assign(globalThis, { MediaRecorder: FakeMediaRecorder });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [{ stop: mock() }] }),
    },
  });
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  HTMLInputElement.prototype.click = realClick;
});

const render = async (node: ReactNode) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(node));
  return container;
};

test("U and R work with no New menu on screen, as on a phone with its menu closed", async () => {
  await render(
    <AddCardProvider>
      <main>Library</main>
    </AddCardProvider>
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();

  await act(() => {
    expect(pressUploadFiles()).toBe(true);
  });
  expect(pickerOpens).toHaveBeenCalledTimes(1);

  await act(async () => {
    expect(pressRecordAudio()).toBe(true);
    // Let the microphone grant resolve.
    await Promise.resolve();
  });
  expect(recorderStarts).toHaveBeenCalledTimes(1);
  expect(document.querySelector("[data-dialog] h2")?.textContent).toBe(
    "Recording audio"
  );
});

test("the phone's + opens the New menu, without key hints on touch screens", async () => {
  const newNote = mock();
  const container = await render(
    <AddCardProvider onNewNote={newNote}>
      <AddCardButton />
    </AddCardProvider>
  );
  const plus = container.querySelector<HTMLButtonElement>(
    'button[aria-label="New"]'
  );
  expect(plus?.className).toContain("md:hidden");

  const items = [...container.querySelectorAll('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toEqual([
    "Note or linkN",
    "Upload filesU",
    "Record audioR",
  ]);
  for (const hint of container.querySelectorAll("kbd")) {
    expect(hint.className).toContain("pointer-coarse:hidden");
  }

  await act(async () => (items[1] as HTMLButtonElement).click());
  expect(pickerOpens).toHaveBeenCalledTimes(1);
});

test("the + isn't shown where nothing can add cards", async () => {
  const container = await render(<AddCardButton />);
  expect(container.innerHTML).toBe("");
});
