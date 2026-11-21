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
});

function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme();
  return <output>{`${theme} ${resolvedTheme}`}</output>;
}

test("a theme picked while storage refuses writes is still the one in use", async () => {
  const refuse = spyOn(Storage.prototype, "setItem").mockImplementation(() => {
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
