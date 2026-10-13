import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const realSonner = await import("sonner");

mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));

const toastError = mock();
mock.module("sonner", () => ({
  ...realSonner,
  toast: Object.assign(mock(), {
    ...realSonner.toast,
    dismiss: mock(),
    error: toastError,
    loading: mock(),
    success: mock(),
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MAX_FILES_PER_UPLOAD } = await import("@teak/convex/shared");
const { GlobalFileDropProvider, useGlobalFileDrop } = await import(
  "../GlobalFileDropProvider"
);

let root: Root | undefined;
let drop: ReturnType<typeof useGlobalFileDrop>;

function Harness() {
  drop = useGlobalFileDrop();
  return null;
}

// An unknown extension fails validation before any network work.
const files = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => new File(["x"], `file-${index}.zzqq`, { type: "" })
  );

beforeEach(async () => {
  toastError.mockClear();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <GlobalFileDropProvider>
        <Harness />
      </GlobalFileDropProvider>
    )
  );
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("the too-many-files notice closes itself and can be closed early", async () => {
  await act(() => drop?.enqueueFiles(files(MAX_FILES_PER_UPLOAD + 1)));

  const notice = toastError.mock.calls.find(
    ([message]) =>
      message ===
      `You can only upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`
  );
  expect(notice).toBeDefined();
  expect(Number.isFinite(notice?.[1]?.duration)).toBe(true);
  expect(notice?.[1]?.closeButton).toBe(true);
});

test("a selection within the limit shows no too-many-files notice", async () => {
  await act(() => drop?.enqueueFiles(files(MAX_FILES_PER_UPLOAD)));

  const messages = toastError.mock.calls.map(([message]) => message);
  expect(messages).not.toContain(
    `You can only upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`
  );
});
