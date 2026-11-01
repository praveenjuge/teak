import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Sidebar, SidebarMenuButton, SidebarProvider } = await import(
  "../sidebar"
);

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const sidebar = (open: boolean) => (
  <SidebarProvider open={open}>
    <SidebarMenuButton tooltip="Trash">Trash</SidebarMenuButton>
  </SidebarProvider>
);

const tooltip = () => document.querySelector('[role="tooltip"]');

test("a menu button shows its tooltip only while the sidebar is collapsed, without switching control modes", async () => {
  const warn = spyOn(console, "warn");
  const error = spyOn(console, "error");
  try {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root?.render(sidebar(true)));
    const button = container.querySelector("button");
    await act(() => button?.focus());
    expect(tooltip()).toBeNull();
    await act(() => button?.blur());

    await act(() => root?.render(sidebar(false)));
    await act(() => button?.focus());
    expect(tooltip()?.textContent).toBe("Trash");
    await act(() => button?.blur());

    await act(() => root?.render(sidebar(true)));
    const messages = [...warn.mock.calls, ...error.mock.calls].map((call) =>
      call.map(String).join(" ")
    );
    expect(
      messages.filter((message) =>
        /controlled to (un)?controlled/.test(message)
      )
    ).toEqual([]);
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
});

test("hovering the collapsed icon rail keeps it collapsed", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <SidebarProvider open={false}>
        <Sidebar collapsible="icon">
          <SidebarMenuButton tooltip="Trash">Trash</SidebarMenuButton>
        </Sidebar>
      </SidebarProvider>
    )
  );
  const sidebarRoot = container.querySelector('[data-slot="sidebar"]');
  const rail = container.querySelector('[data-slot="sidebar-container"]');
  expect(sidebarRoot?.getAttribute("data-collapsible")).toBe("icon");

  await act(async () => {
    rail?.dispatchEvent(new MouseEvent("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  expect(sidebarRoot?.getAttribute("data-collapsible")).toBe("icon");
  expect(sidebarRoot?.getAttribute("data-state")).toBe("collapsed");
});
