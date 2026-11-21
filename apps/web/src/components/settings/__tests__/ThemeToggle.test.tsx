import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ThemeToggle } = await import("../ThemeToggle");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const button = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

test("each theme button saves its choice, marks itself pressed and repaints the page", async () => {
  const picked: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(<ThemeToggle onThemeChange={(t) => picked.push(t)} />)
  );
  expect(button("Use system theme")?.getAttribute("aria-pressed")).toBe("true");

  for (const [name, value] of [
    ["Use dark theme", "dark"],
    ["Use light theme", "light"],
  ] as const) {
    await act(() => button(name)?.click());
    expect(button(name)?.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("theme")).toBe(value);
    expect(document.documentElement.classList.contains(value)).toBe(true);
  }

  await act(() => button("Use system theme")?.click());
  expect(button("Use system theme")?.getAttribute("aria-pressed")).toBe("true");
  expect(button("Use light theme")?.getAttribute("aria-pressed")).toBe("false");
  expect(localStorage.getItem("theme")).toBe("system");
  expect(picked).toEqual(["dark", "light", "system"]);
});
