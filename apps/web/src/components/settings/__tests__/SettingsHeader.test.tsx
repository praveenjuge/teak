import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000/settings" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

mock.module("@/components/sidebar", () => ({
  SidebarToggle: () => null,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SettingsHeader } = await import("../SettingsHeader");
const { TestRouter, testRouter } = await import("@/__tests__/helpers/router");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const render = async (path: string) => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <TestRouter router={testRouter(path)}>
        <SettingsHeader />
      </TestRouter>
    )
  );
  return container;
};

test("a sub-page's name is part of the heading", async () => {
  const container = await render("/settings/appearance");
  const heading = container.querySelector("h1");
  expect(heading?.textContent).toBe("SettingsAppearance");
  expect(heading?.querySelector('[aria-current="page"]')?.textContent).toBe(
    "Appearance"
  );
  expect(heading?.querySelector('a[href="/settings"]')).not.toBeNull();
});

test("the account page is headed Settings", async () => {
  const container = await render("/settings");
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
});
