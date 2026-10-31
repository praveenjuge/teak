import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, Activity } = await import("react");
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

// Next.js hides a page it leaves in an <Activity>; useEditor destroys the
// editor while hidden. Coming back must not throw or take focus again.
test("hands focus over once, not again when a hidden page comes back", async () => {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", onError);
  const container = document.createElement("div");
  document.body.append(container);
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  root = createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  const page = (mode: "hidden" | "visible") => (
    <Activity mode={mode}>
      <LoadedMarkdownTextEditor
        ariaLabel="Markdown content"
        onChange={() => undefined}
        standInFocus={{ current: true }}
        value="Typed while loading"
      />
    </Activity>
  );
  try {
    await act(() => root?.render(page("visible")));
    for (
      let tick = 0;
      tick < 50 && !container.querySelector(".ProseMirror");
      tick++
    ) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    expect(document.activeElement?.closest(".ProseMirror")).not.toBeNull();
    elsewhere.focus();

    await act(() => root?.render(page("hidden")));
    await act(() => root?.render(page("visible")));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(errors).toEqual([]);
    expect(document.activeElement).toBe(elsewhere);
  } finally {
    window.removeEventListener("error", onError);
  }
});

async function renderChecklist(
  value: string,
  onChange = (_next: string) => undefined
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <LoadedMarkdownTextEditor
        ariaLabel="Markdown content"
        onChange={onChange}
        value={value}
      />
    )
  );
  const checkboxFor = (text: string) =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label='Task item checkbox for ${text}']`
    );
  for (let wait = 0; wait < 50 && !container.querySelector("ul"); wait++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  return {
    itemFor: (text: string) => checkboxFor(text)?.closest("li") ?? null,
    tick: async (text: string) => {
      const box = checkboxFor(text);
      if (!box) {
        throw new Error(`No checkbox for ${text}`);
      }
      await act(() => {
        box.checked = !box.checked;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
  };
}

test("a tick reports the reordered list, not the list before the move", async () => {
  const onChange = mock((_next: string) => undefined);
  const list = await renderChecklist("- [ ] A\n- [ ] B", onChange);
  await list.tick("A");
  expect(onChange.mock.lastCall?.[0]).toBe("- [ ] B\n- [x] A");
});

describe("the move slides", () => {
  const rowTop = (element: Element) =>
    element.tagName === "LI" && element.parentElement
      ? Array.prototype.indexOf.call(element.parentElement.children, element) *
        20
      : 0;
  const animate = mock(function (this: Element, keyframes: Keyframe[]) {
    return { keyframes, target: this } as unknown as Animation;
  });
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  const realAnimate = HTMLElement.prototype.animate;
  const realGetAnimations = HTMLElement.prototype.getAnimations;
  const realMatchMedia = window.matchMedia;
  let reducedMotion = false;

  beforeEach(() => {
    animate.mockClear();
    reducedMotion = false;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return { top: rowTop(this) } as DOMRect;
    };
    HTMLElement.prototype.animate = animate as unknown as typeof realAnimate;
    HTMLElement.prototype.getAnimations = () => [];
    window.matchMedia = ((query: string) => ({
      matches: reducedMotion && query.includes("reduce"),
    })) as unknown as typeof window.matchMedia;
  });

  afterAll(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect;
    HTMLElement.prototype.animate = realAnimate;
    HTMLElement.prototype.getAnimations = realGetAnimations;
    window.matchMedia = realMatchMedia;
  });

  const slides = () =>
    animate.mock.calls.map((call, index) => ({
      text: (animate.mock.contexts[index] as Element).textContent,
      from: (call[0] as Keyframe[])[0].transform,
    }));

  test("each item in the moved run from its old place to its new one", async () => {
    const list = await renderChecklist("- [ ] A\n- [ ] B\n- [ ] C");
    await list.tick("A");
    expect(slides()).toEqual([
      { text: expect.stringContaining("B"), from: "translateY(20px)" },
      { text: expect.stringContaining("C"), from: "translateY(20px)" },
      { text: expect.stringContaining("A"), from: "translateY(-40px)" },
    ]);
  });

  test("not when the reader prefers reduced motion", async () => {
    reducedMotion = true;
    const list = await renderChecklist("- [ ] A\n- [ ] B");
    await list.tick("A");
    expect(list.itemFor("A")?.parentElement?.lastElementChild).toBe(
      list.itemFor("A")
    );
    expect(animate).not.toHaveBeenCalled();
  });
});
