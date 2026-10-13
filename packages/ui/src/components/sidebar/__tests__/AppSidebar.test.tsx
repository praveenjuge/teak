import { afterEach, describe, expect, mock, test } from "bun:test";
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
    activeTypes?: ("link" | "image")[];
    activeView?: "all" | "favorites" | "archive" | "trash" | null;
    defaultOpen?: boolean;
    isSettingsActive?: boolean;
  } = {},
  onToggleType = mock()
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <SidebarProvider defaultOpen={options.defaultOpen ?? true}>
        <AppSidebar
          activeTypes={options.activeTypes ?? []}
          activeView={
            options.activeView === undefined ? "all" : options.activeView
          }
          foldersSlot={<div data-testid="folders">Folders</div>}
          isSettingsActive={options.isSettingsActive}
          LinkComponent={Link}
          onToggleType={onToggleType}
          tagsSlot={<div data-testid="tags">Tags</div>}
        />
      </SidebarProvider>
    )
  );
  return onToggleType;
}

const link = (name: string) =>
  [...document.querySelectorAll("a")].find(
    (anchor) =>
      (anchor.getAttribute("aria-label") ?? anchor.textContent?.trim()) === name
  );
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name
  );

describe("AppSidebar", () => {
  test("marks only the open view as the current page", async () => {
    await renderSidebar({ activeView: "archive" });
    expect(link("Archive")?.getAttribute("aria-current")).toBe("page");
    expect(link("Archive")?.getAttribute("href")).toBe("/archive");
    for (const name of ["Everything", "Favorites", "Trash", "Settings"]) {
      expect(link(name)?.hasAttribute("aria-current")).toBe(false);
    }
  });

  test("marks Settings as current outside the library", async () => {
    await renderSidebar({ activeView: null, isSettingsActive: true });
    expect(link("Settings")?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  test("shows picked card types as pressed and toggles them", async () => {
    const onToggleType = await renderSidebar({ activeTypes: ["image"] });
    expect(button("Image")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Link")?.getAttribute("aria-pressed")).toBe("false");
    await act(() => button("Link")?.click());
    expect(onToggleType).toHaveBeenCalledWith("link");
  });

  test("renders the folders and tags slots", async () => {
    await renderSidebar();
    expect(document.querySelector('[data-testid="folders"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="tags"]')).not.toBeNull();
  });

  test("keeps every item's accessible name when collapsed to icons", async () => {
    await renderSidebar({ defaultOpen: false });
    expect(
      document
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-collapsible")
    ).toBe("icon");
    for (const name of ["Everything", "Favorites", "Archive", "Trash"]) {
      expect(link(name)).toBeDefined();
    }
    expect(link("Settings")).toBeDefined();
    expect(button("Quote")).toBeDefined();
  });
});
