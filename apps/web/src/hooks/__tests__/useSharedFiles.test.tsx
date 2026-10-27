import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const shared = [new File(["a"], "a.png", { type: "image/png" })];
const enqueueFiles = mock((_files: File[]) => undefined);
const prompts: Array<{
  message: string;
  options: { action: { onClick: () => void } };
}> = [];
mock.module("@/components/providers/GlobalFileDropProvider", () => ({
  useGlobalFileDrop: () => ({ enqueueFiles }),
}));
mock.module("@/lib/share/sharedFiles", () => ({
  takeSharedFiles: () => Promise.resolve(shared),
}));
mock.module("sonner", () => ({
  toast: Object.assign(
    (message: string, options: (typeof prompts)[number]["options"]) =>
      prompts.push({ message, options }),
    { error: () => undefined }
  ),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSharedFiles } = await import("../useSharedFiles");

let root: Root | undefined;
let standalone = false;

function Harness({ id }: { id: string }) {
  useSharedFiles(id);
  return null;
}

const share = async (id: string) => {
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(<Harness id={id} />);
    await Promise.resolve();
  });
};

beforeEach(() => {
  enqueueFiles.mockClear();
  prompts.length = 0;
  window.matchMedia = ((query: string) => ({
    matches: query === "(display-mode: standalone)" && standalone,
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

test("the installed app uploads files from the share sheet at once", async () => {
  standalone = true;
  await share("share_a");
  expect(enqueueFiles).toHaveBeenCalledWith(shared);
  expect(prompts).toHaveLength(0);
});

test("a browser tab asks before saving files another page posted", async () => {
  standalone = false;
  await share("share_b");
  expect(enqueueFiles).not.toHaveBeenCalled();
  expect(prompts.map((prompt) => prompt.message)).toEqual([
    "Save the shared file to Teak?",
  ]);
  prompts[0]?.options.action.onClick();
  expect(enqueueFiles).toHaveBeenCalledWith(shared);
});
