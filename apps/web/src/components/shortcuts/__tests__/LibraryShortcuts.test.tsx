import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

mock.module(
  "../../command-palette/CommandPalette",
  () => new Promise(() => undefined)
);
mock.module("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: () => undefined }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { isApplePlatform } = await import("../../../lib/platform");
const { LibraryShortcuts, toggledTheme } = await import("../LibraryShortcuts");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function renderShortcuts(onGoToView: (view: string) => void) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <LibraryShortcuts
        onGoToView={onGoToView}
        onNavigate={() => undefined}
        onSignOut={() => undefined}
        pathname="/"
      />
    )
  );
}

const press = (key: string, modifier = false) =>
  act(() => {
    const apple = isApplePlatform();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: modifier && !apple,
        key,
        metaKey: modifier && apple,
      })
    );
  });

test("go-to shortcuts run while the palette is closed", async () => {
  const onGoToView = mock((_view: string) => undefined);
  await renderShortcuts(onGoToView);
  await press("g");
  await press("f");
  expect(onGoToView).toHaveBeenCalledWith("favorites");
});

test("keys typed while the palette is still loading stay out of the library", async () => {
  const onGoToView = mock((_view: string) => undefined);
  await renderShortcuts(onGoToView);
  await press("k", true);
  await press("g");
  await press("f");
  expect(onGoToView).not.toHaveBeenCalled();
});

test("Toggle theme flips light and dark, and flipping back follows the system again", () => {
  // Following a light system: one toggle goes dark, the next back to System.
  expect(toggledTheme("light", "light")).toBe("dark");
  expect(toggledTheme("dark", "light")).toBe("system");
  // Following a dark system.
  expect(toggledTheme("dark", "dark")).toBe("light");
  expect(toggledTheme("light", "dark")).toBe("system");
});
