import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({
  url: "http://localhost:3000",
  width: 1440,
  height: 900,
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SidebarProvider } = await import("../../ui/sidebar");
const { AppSidebar } = await import("../AppSidebar");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const Link = ({
  children,
  href,
  ...props
}: {
  children: ReactNode;
  href: string;
  [key: string]: unknown;
}) => (
  <a href={href} {...props}>
    {children}
  </a>
);

async function renderSidebar(
  options: {
    activeView?: "all" | "favorites" | "archive" | "trash" | null;
    defaultOpen?: boolean;
    isSettingsActive?: boolean;
    isTagsActive?: boolean;
  } = {}
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <SidebarProvider defaultOpen={options.defaultOpen ?? true}>
        <AppSidebar
          activeView={
            options.activeView === undefined ? "all" : options.activeView
          }
          foldersSlot={<div data-testid="folders">Folders</div>}
          isSettingsActive={options.isSettingsActive}
          isTagsActive={options.isTagsActive}
          LinkComponent={Link}
        />
      </SidebarProvider>
    )
  );
}

const link = (name: string) =>
  [...document.querySelectorAll("a")].find(
    (anchor) =>
      (anchor.getAttribute("aria-label") ?? anchor.textContent?.trim()) === name
  );
const sidebarState = () =>
  document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state");

describe("AppSidebar", () => {
  test("keeps go-to keys in tooltips, not beside the links", async () => {
    await renderSidebar();
    expect(
      document.querySelector('[data-sidebar="menu-badge"] kbd')
    ).toBeNull();
    expect(link("Favorites")?.textContent?.trim()).toBe("Favorites");
    expect(link("Trash")?.textContent?.trim()).toBe("Trash");
  });

  test("marks only the open view as the current page", async () => {
    await renderSidebar({ activeView: "archive" });
    expect(link("Archive")?.getAttribute("aria-current")).toBe("page");
    expect(link("Archive")?.getAttribute("href")).toBe("/archive");
    for (const name of [
      "Everything",
      "Favorites",
      "Tags",
      "Trash",
      "Settings",
    ]) {
      expect(link(name)?.hasAttribute("aria-current")).toBe(false);
    }
  });

  test("lists Tags right after Favorites and marks it on the Tags page", async () => {
    await renderSidebar({ activeView: null, isTagsActive: true });
    const names = [...document.querySelectorAll("a")].map(
      (anchor) =>
        anchor.getAttribute("aria-label") ?? anchor.textContent?.trim()
    );
    expect(names.indexOf("Tags")).toBe(names.indexOf("Favorites") + 1);
    expect(link("Tags")?.getAttribute("href")).toBe("/tags");
    expect(link("Tags")?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  test("marks Settings as current outside the library", async () => {
    await renderSidebar({ activeView: null, isSettingsActive: true });
    expect(link("Settings")?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  test("lists the library, then folders, then Archive, Trash and Settings", async () => {
    await renderSidebar();
    const order = [
      ...document.querySelectorAll('a, [data-testid="folders"]'),
    ].map(
      (element) =>
        element.getAttribute("data-testid") ??
        element.getAttribute("aria-label") ??
        element.textContent?.trim()
    );
    expect(order).toEqual([
      "Teak home",
      "Everything",
      "Favorites",
      "Tags",
      "folders",
      "Archive",
      "Trash",
      "Settings",
    ]);
    const foot = document.querySelector('[data-slot="sidebar-footer"]');
    expect(
      [...(foot?.querySelectorAll("a") ?? [])].map(
        (anchor) =>
          anchor.getAttribute("aria-label") ?? anchor.textContent?.trim()
      )
    ).toEqual(["Archive", "Trash", "Settings"]);
    expect(
      document.querySelector(
        '[data-slot="sidebar-content"] [data-slot="sidebar-footer"]'
      )
    ).toBeNull();
    expect(document.body.textContent).not.toContain("Types");
  });

  test("keeps its collapse button in the collapsed rail", async () => {
    await renderSidebar({ defaultOpen: false });
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-sidebar="collapse"]'
    );
    expect(toggle?.getAttribute("aria-label")).toBe("Keep sidebar open");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      toggle?.click();
    });
    expect(sidebarState()).toBe("expanded");
  });

  test("its edge expands the collapsed sidebar but never collapses it", async () => {
    await renderSidebar({ defaultOpen: false });
    const rail = () =>
      document.querySelector<HTMLButtonElement>('[data-slot="sidebar-rail"]');
    expect(rail()?.getAttribute("aria-label")).toBe("Expand sidebar");
    await act(() => rail()?.click());
    expect(sidebarState()).toBe("expanded");
    expect(rail()?.getAttribute("aria-label")).toBe("Resize sidebar");
    await act(() => rail()?.click());
    expect(sidebarState()).toBe("expanded");
  });

  test("renders the folders slot", async () => {
    await renderSidebar();
    expect(document.querySelector('[data-testid="folders"]')).not.toBeNull();
  });

  test("keeps every item's accessible name when collapsed to icons", async () => {
    await renderSidebar({ defaultOpen: false });
    expect(
      document
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-collapsible")
    ).toBe("icon");
    for (const name of [
      "Everything",
      "Favorites",
      "Tags",
      "Archive",
      "Trash",
    ]) {
      expect(link(name)).toBeDefined();
    }
    expect(link("Settings")).toBeDefined();
  });
});
