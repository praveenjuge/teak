import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000/?q=design" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MAIN_CONTENT_ID, SkipToContent } = await import("../SkipToContent");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("the first link jumps focus to the page, leaving the URL alone", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <>
        <SkipToContent />
        <nav>
          <a href="/favorites">Favorites</a>
        </nav>
        <main id={MAIN_CONTENT_ID}>
          <button type="button">First control</button>
        </main>
      </>
    )
  );
  const skip = container.querySelector("a");
  expect(skip?.textContent).toBe("Skip to content");
  expect(skip?.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);

  await act(async () => {
    skip?.click();
    await Promise.resolve();
  });
  const main = document.getElementById(MAIN_CONTENT_ID);
  expect(document.activeElement).toBe(main);
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("?q=design");

  // `main` is focusable only for the jump.
  await act(async () => {
    container.querySelector<HTMLButtonElement>("main button")?.focus();
    await Promise.resolve();
  });
  expect(main?.hasAttribute("tabindex")).toBe(false);
});
