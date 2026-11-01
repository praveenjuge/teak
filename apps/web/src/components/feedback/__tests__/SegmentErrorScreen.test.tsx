import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const captured: unknown[][] = [];
mock.module("@teak/convex/shared/clientTelemetry", () => ({
  captureClientException: (...args: unknown[]) => captured.push(args),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SidebarProvider } = await import("@/components/ui/sidebar");
const { SegmentErrorScreen } = await import("../SegmentErrorScreen");
const { SidebarFoldersBoundary } = await import(
  "@/components/sidebar/SidebarFoldersBoundary"
);

let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  captured.length = 0;
});

const render = async (node: React.ReactNode) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<SidebarProvider>{node}</SidebarProvider>));
  return container;
};

const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) => element.textContent === name
  );

test("a page that fails says so in place, reports it, and Try again reloads", async () => {
  const reload = mock();
  Object.defineProperty(window.location, "reload", {
    configurable: true,
    value: reload,
  });
  const error = Object.assign(new Error("[CONVEX Q(tags:listTagSummary)]"), {
    digest: "abc",
  });
  const container = await render(
    <SegmentErrorScreen boundary="app" error={error} />
  );

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Something went wrong. Please try again.Try again"
  );
  expect(captured).toEqual([[error, { digest: "abc", "ui.boundary": "app" }]]);
  await act(async () => button("Try again")?.click());
  expect(reload).toHaveBeenCalledTimes(1);
});

function BrokenFolders(): never {
  throw new Error("[CONVEX Q(folders:listFolders)] Server Error");
}

test("folders that fail to load leave the rest of the sidebar standing", async () => {
  const consoleError = console.error;
  console.error = () => undefined;
  try {
    const container = await render(
      <nav>
        <a href="/">Everything</a>
        <SidebarFoldersBoundary>
          <BrokenFolders />
        </SidebarFoldersBoundary>
      </nav>
    );
    expect(container.querySelector("a")?.textContent).toBe("Everything");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't load your folders.Try again"
    );
    expect(captured).toHaveLength(1);
  } finally {
    console.error = consoleError;
  }
});
