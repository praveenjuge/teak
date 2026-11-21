import { afterEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { setThemePreference, useTheme } = await import("../useTheme");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme();
  return <output>{`${theme} ${resolvedTheme}`}</output>;
}

test("a theme picked while storage refuses writes is still the one in use", async () => {
  const refuse = spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  try {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root?.render(<ThemeProbe />));

    await act(() => setThemePreference("dark"));

    expect(container.textContent).toBe("dark dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  } finally {
    refuse.mockRestore();
  }
});

test("a choice made in another tab applies here", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<ThemeProbe />));

  // The other tab writes the shared storage, then this tab hears of it.
  localStorage.setItem("theme", "light");
  await act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "light" })
    );
  });

  expect(container.textContent).toBe("light light");
  expect(document.documentElement.classList.contains("light")).toBe(true);
});

test("an out-of-date event from another tab doesn't undo a newer choice", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<ThemeProbe />));

  await act(() => setThemePreference("dark"));
  await act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "light" })
    );
  });

  expect(container.textContent).toBe("dark dark");
});

test("the window listeners come off when the last reader goes, whichever it is", async () => {
  const added = spyOn(window, "addEventListener");
  const removed = spyOn(window, "removeEventListener");
  const storageCalls = (spy: typeof added) =>
    spy.mock.calls.filter(([type]) => type === "storage").length;
  try {
    const first = createRoot(document.createElement("div"));
    const second = createRoot(document.createElement("div"));
    await act(() => first.render(<ThemeProbe />));
    await act(() => second.render(<ThemeProbe />));
    // The first reader leaves before the second.
    await act(() => first.unmount());
    expect(storageCalls(removed)).toBe(0);
    await act(() => second.unmount());
    expect(storageCalls(removed)).toBe(1);

    const again = createRoot(document.createElement("div"));
    await act(() => again.render(<ThemeProbe />));
    await act(() => again.unmount());
    expect(storageCalls(added)).toBe(2);
    expect(storageCalls(removed)).toBe(2);
  } finally {
    added.mockRestore();
    removed.mockRestore();
  }
});
