import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { LibraryCommandsProvider, useLibraryCommand, useRunLibraryCommand } =
  await import("../LibraryCommandsProvider");

let root: Root | undefined;
let run: ReturnType<typeof useRunLibraryCommand> = () => false;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

function Runner() {
  run = useRunLibraryCommand();
  return null;
}

function Uploader({ onUpload }: { onUpload: () => boolean }) {
  useLibraryCommand("uploadFiles", onUpload);
  return null;
}

async function render(uploaders: Array<() => boolean>) {
  root ??= createRoot(document.createElement("div"));
  await act(() =>
    root?.render(
      <LibraryCommandsProvider>
        <Runner />
        {uploaders.map((onUpload, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the test's list is fixed
          <Uploader key={index} onUpload={onUpload} />
        ))}
      </LibraryCommandsProvider>
    )
  );
}

test("a command nothing answers does nothing", async () => {
  await render([]);
  expect(run("uploadFiles")).toBe(false);
});

test("the latest part of the page to offer a command answers it", async () => {
  const toolbar = mock(() => true);
  const header = mock(() => true);
  await render([toolbar, header]);
  expect(run("uploadFiles")).toBe(true);
  expect(header).toHaveBeenCalledTimes(1);
  expect(toolbar).not.toHaveBeenCalled();

  await render([toolbar]);
  expect(run("uploadFiles")).toBe(true);
  expect(toolbar).toHaveBeenCalledTimes(1);
});

test("a handler that can't run now says so", async () => {
  await render([() => false]);
  expect(run("uploadFiles")).toBe(false);
});

test("the handler answering is the one from the latest render", async () => {
  const first = mock(() => true);
  const second = mock(() => true);
  await render([first]);
  await render([second]);
  run("uploadFiles");
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
