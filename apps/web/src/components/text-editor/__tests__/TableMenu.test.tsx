import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Editor } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { TableMenu } = await import("../TableMenu");

let root: Root | undefined;
let editor: InstanceType<typeof Editor> | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  editor?.destroy();
  root = undefined;
  editor = undefined;
  document.body.innerHTML = "";
});

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

async function mountedEditor() {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    content: "<p>text</p>",
    element,
    extensions: [StarterKit],
  });
  await tick();
  return editor;
}

function render(ui: ReactNode, errors: unknown[]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container, {
    onCaughtError: (error) => errors.push(error),
    onUncaughtError: (error) => errors.push(error),
  });
  return act(() => root?.render(ui));
}

test("disconnecting the menu after its editor unmounted does not throw", async () => {
  const errors: unknown[] = [];
  const live = await mountedEditor();
  await render(<TableMenu editor={live} />, errors);
  live.unmount();
  await act(() => root?.unmount());
  expect(errors.map(String)).toEqual([]);
});

test("connecting the menu to an unmounted editor does not throw", async () => {
  const errors: unknown[] = [];
  const live = await mountedEditor();
  live.unmount();
  await render(<TableMenu editor={live} />, errors);
  expect(errors.map(String)).toEqual([]);
});
