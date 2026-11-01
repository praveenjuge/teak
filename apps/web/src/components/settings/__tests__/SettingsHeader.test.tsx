import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000/settings" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let pathname = "/settings";
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  usePathname: () => pathname,
}));
mock.module("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children?: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
mock.module("@/components/sidebar", () => ({
  SidebarToggle: () => null,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SettingsHeader } = await import("../SettingsHeader");

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
  pathname = path;
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => root?.render(<SettingsHeader />));
  return container;
};

test("a sub-page's name is part of the heading and the document title", async () => {
  const container = await render("/settings/appearance");
  const heading = container.querySelector("h1");
  expect(heading?.textContent).toBe("SettingsAppearance");
  expect(heading?.querySelector('[aria-current="page"]')?.textContent).toBe(
    "Appearance"
  );
  expect(heading?.querySelector('a[href="/settings"]')).not.toBeNull();
  expect(document.title).toBe("Appearance · Settings · Teak");
});

test("the account page is titled Settings", async () => {
  const container = await render("/settings");
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
  expect(document.title).toBe("Settings · Teak");
});
