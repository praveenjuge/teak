import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const realSonner = await import("sonner");

let finalizeResult: Record<string, unknown>;
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => async () => finalizeResult,
  useMutation: () => async () => ({
    success: true,
    uploadKey: "upload-key",
    uploadUrl: "https://uploads.test/file",
  }),
}));

const toastError = mock();
const toastSuccess = mock();
const toastWarning = mock();
mock.module("sonner", () => ({
  ...realSonner,
  toast: Object.assign(mock(), {
    ...realSonner.toast,
    dismiss: mock(),
    error: toastError,
    loading: mock(),
    success: toastSuccess,
    warning: toastWarning,
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MAX_FILES_PER_UPLOAD } = await import("@teak/convex/shared");
const { GlobalFileDropProvider, useGlobalFileDrop } = await import(
  "../GlobalFileDropProvider"
);

const realFetch = globalThis.fetch;
let root: Root | undefined;
let drop: ReturnType<typeof useGlobalFileDrop>;

function Harness() {
  drop = useGlobalFileDrop();
  return null;
}

const files = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      new File(["note"], `note-${index}.txt`, { type: "text/plain" })
  );

const resultToasts = () => [
  ...toastSuccess.mock.calls,
  ...toastWarning.mock.calls,
  ...toastError.mock.calls,
];

async function enqueueAndWaitForResult(count: number) {
  await act(async () => drop?.enqueueFiles(files(count)));
  for (let step = 0; step < 100 && resultToasts().length === 0; step += 1) {
    await act(async () => jest.advanceTimersByTime(100));
  }
}

beforeEach(async () => {
  finalizeResult = { success: true, cardId: "card-1" };
  for (const toastMock of [toastError, toastSuccess, toastWarning]) {
    toastMock.mockClear();
  }
  jest.useFakeTimers();
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 })
  ) as unknown as typeof fetch;
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
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

test("picking too many files ends in one closing toast that names the skipped files", async () => {
  await enqueueAndWaitForResult(MAX_FILES_PER_UPLOAD + 2);

  expect(toastError).not.toHaveBeenCalled();
  expect(toastSuccess).not.toHaveBeenCalled();
  expect(toastWarning).toHaveBeenCalledTimes(1);
  const [message, options] = toastWarning.mock.calls[0];
  expect(message).toBe(
    `Uploaded ${MAX_FILES_PER_UPLOAD} files. 2 files were skipped. You can upload up to ${MAX_FILES_PER_UPLOAD} at a time.`
  );
  expect(Number.isFinite(options.duration)).toBe(true);
  expect(options.closeButton).toBe(true);
});

test("picking files within the limit ends in a plain success toast", async () => {
  await enqueueAndWaitForResult(MAX_FILES_PER_UPLOAD);

  expect(toastWarning).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
  expect(toastSuccess).toHaveBeenCalledTimes(1);
  expect(toastSuccess.mock.calls[0][0]).toBe(
    `Uploaded ${MAX_FILES_PER_UPLOAD} files`
  );
});

test("a rate-limited upload still says which files were skipped", async () => {
  finalizeResult = {
    success: false,
    error: "Too many cards created.",
    errorCode: "RATE_LIMITED",
  };
  await enqueueAndWaitForResult(MAX_FILES_PER_UPLOAD + 3);

  expect(toastError).toHaveBeenCalledTimes(1);
  expect(toastError.mock.calls[0][0]).toBe(
    `Too many cards created. Please wait a moment. 3 files were skipped. You can upload up to ${MAX_FILES_PER_UPLOAD} at a time.`
  );
});

function pasteFile() {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: files(1), items: [], types: ["Files"] },
  });
  document.body.dispatchEvent(event);
  return event;
}

test("a pasted file uploads as a new card", async () => {
  await act(async () => pasteFile());
  for (let step = 0; step < 100 && resultToasts().length === 0; step += 1) {
    await act(async () => jest.advanceTimersByTime(100));
  }

  expect(globalThis.fetch).toHaveBeenCalled();
});

test("a paste the open card claims never uploads", async () => {
  const claimed: ClipboardEvent[] = [];
  const release = drop?.claimPaste((event) => {
    claimed.push(event);
    return true;
  });

  await act(async () => pasteFile());
  await act(async () => jest.advanceTimersByTime(1000));

  expect(claimed).toHaveLength(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  release?.();
});

test("a paste the card passes on still uploads", async () => {
  drop?.claimPaste(() => false);

  await act(async () => pasteFile());
  for (let step = 0; step < 100 && resultToasts().length === 0; step += 1) {
    await act(async () => jest.advanceTimersByTime(100));
  }

  expect(globalThis.fetch).toHaveBeenCalled();
});
