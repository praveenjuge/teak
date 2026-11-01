import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TagManagerDialog } = await import("../TagManagerDialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const tags = [
  { name: "design", count: 4 },
  { name: "art", count: 2 },
  { name: "web", count: 1 },
];

const renderMerge = async (onStart: (input: unknown) => Promise<unknown>) => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <TagManagerDialog
        mode="merge"
        onModeChange={() => undefined}
        onOpenChange={() => undefined}
        onStart={onStart}
        open
        tag={{ name: "design", count: 4 }}
        tags={tags}
      />
    )
  );
};

const find = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Find a tag"]');

const press = (key: string) =>
  act(() => {
    find()?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
    );
  });

const activeOption = () => {
  const id = find()?.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : undefined;
};

test("the merge picker moves with the arrows, picks with Enter, then merges", async () => {
  const onStart = mock(async (_input: unknown) => undefined);
  await renderMerge(onStart);
  expect(find()?.getAttribute("role")).toBe("combobox");
  expect(activeOption()).toContain("art");

  await press("ArrowDown");
  expect(activeOption()).toContain("web");
  await press("ArrowDown");
  expect(activeOption()).toContain("art");
  await press("ArrowUp");
  expect(activeOption()).toContain("web");

  await press("Enter");
  const selected = document.querySelector(
    '[role="option"][aria-selected="true"]'
  );
  expect(selected?.textContent).toContain("web");
  expect(onStart).not.toHaveBeenCalled();
  const submit = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Merge into “web”"
  );
  expect(submit).toBeDefined();
});
