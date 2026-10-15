import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(navigator, "platform", {
  configurable: true,
  get: () => "MacIntel",
});

const { act } = await import("react");
const { renderToString } = await import("react-dom/server");
const { createRoot, hydrateRoot } = await import("react-dom/client");
const { ShortcutKeys } = await import("../ShortcutTooltip");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ShortcutKeys", () => {
  test("shows ⌘ on a Mac", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root?.render(<ShortcutKeys keys={["Mod", "B"]} />));
    expect(container.textContent).toBe("⌘B");
  });

  test("renders Ctrl on the server, then ⌘ once a Mac hydrates it", async () => {
    const html = renderToString(<ShortcutKeys keys={["Mod", "B"]} />);
    expect(html).toContain("Ctrl");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    await act(() => {
      root = hydrateRoot(container, <ShortcutKeys keys={["Mod", "B"]} />);
    });
    expect(container.textContent).toBe("⌘B");
  });
});
