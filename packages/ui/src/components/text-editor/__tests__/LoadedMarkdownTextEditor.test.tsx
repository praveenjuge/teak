import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: LoadedMarkdownTextEditor } = await import(
  "../LoadedMarkdownTextEditor"
);

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("hands focus from the stand-in to the editor with no gap", async () => {
  const focusAfterEachChange: string[] = [];
  const observer = new MutationObserver(() => {
    const active = document.activeElement;
    focusAfterEachChange.push(
      active?.closest(".ProseMirror")
        ? "editor"
        : (active?.tagName.toLowerCase() ?? "none")
    );
  });
  const value = "Typed while loading";
  const onChange = mock((_next: string) => undefined);
  const container = document.createElement("div");
  document.body.append(container);
  observer.observe(container, { childList: true, subtree: true });
  root = createRoot(container);
  await act(() =>
    root?.render(
      <LoadedMarkdownTextEditor
        ariaLabel="Markdown content"
        onChange={onChange}
        standInFocus={{ current: true }}
        value={value}
      />
    )
  );

  for (
    let tick = 0;
    tick < 50 && !container.querySelector(".ProseMirror");
    tick++
  ) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  observer.disconnect();

  expect(container.querySelector("textarea")).toBeNull();
  expect(document.activeElement?.closest(".ProseMirror")).not.toBeNull();
  expect(focusAfterEachChange.length).toBeGreaterThan(0);
  for (const focused of focusAfterEachChange) {
    expect(["textarea", "editor"]).toContain(focused);
  }
  expect(container.querySelector(".ProseMirror")?.textContent).toBe(value);
});

test("a tick reports the reordered list, not the list before the move", async () => {
  const onChange = mock((_next: string) => undefined);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <LoadedMarkdownTextEditor
        ariaLabel="Markdown content"
        onChange={onChange}
        value={"- [ ] A\n- [ ] B"}
      />
    )
  );
  let checkbox: HTMLInputElement | null = null;
  for (let tick = 0; tick < 50 && !checkbox; tick++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    checkbox = container.querySelector<HTMLInputElement>(
      "input[aria-label='Task item checkbox for A']"
    );
  }
  if (!checkbox) {
    throw new Error("The rich editor never showed the task list");
  }
  const box = checkbox;
  await act(() => {
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange.mock.lastCall?.[0]).toBe("- [ ] B\n- [x] A");
});
