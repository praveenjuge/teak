import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({
  url: "http://localhost:3000",
  width: 1440,
  height: 900,
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const LONG_NAME = `Reading list ${"for the long winter ".repeat(10)}`.trim();
const folders = [
  {
    _id: "folder_1",
    activeCardCount: 2,
    kind: "manual",
    name: LONG_NAME,
  },
];

const deleted: string[] = [];
const toasts: string[] = [];
const toastDurations: (number | undefined)[] = [];

mock.module("convex/react", () => ({
  useMutation: (reference: never) => {
    const name = getFunctionName(reference);
    const run = (args: { folderId: string }) => {
      if (name === "folders:deleteFolder") {
        deleted.push(args.folderId);
      }
      return Promise.resolve(null);
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => folders,
}));
mock.module("sonner", () => ({
  toast: Object.assign((message: string) => toasts.push(message), {
    error: (message: string) => toasts.push(message),
    success: (message: string, options?: { duration?: number }) => {
      toasts.push(message);
      toastDurations.push(options?.duration);
    },
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SidebarProvider } = await import("../../ui/sidebar");
const { SidebarFolders } = await import("../SidebarFolders");

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

let root: Root | undefined;

beforeEach(() => {
  deleted.length = 0;
  toasts.length = 0;
  toastDurations.length = 0;
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const render = async (
  activeFolderId: string | null,
  onActiveFolderDeleted?: () => void
) => {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(() =>
    root?.render(
      <SidebarProvider defaultOpen>
        <SidebarFolders
          activeFolderId={activeFolderId}
          LinkComponent={Link}
          onActiveFolderDeleted={onActiveFolderDeleted}
        />
      </SidebarProvider>
    )
  );
};

const deleteFromMenu = async () => {
  const item = document.querySelector('[data-sidebar="menu-item"]');
  await act(() => {
    item?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  const remove = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent?.trim() === "Delete"
  );
  if (!(remove instanceof HTMLElement)) {
    throw new Error("No Delete item");
  }
  await act(async () => {
    remove.click();
    await Promise.resolve();
  });
};

test("deleting the open folder leaves it first, so it never shows as not found", async () => {
  const leave = mock(() => undefined);
  await render("folder_1", leave);
  await deleteFromMenu();

  expect(leave).toHaveBeenCalledTimes(1);
  expect(deleted).toEqual([]);

  await render(null, leave);
  await act(() => Promise.resolve());
  expect(deleted).toEqual(["folder_1"]);
});

test("the Deleted toast clips a long folder name", async () => {
  await render(null);
  await deleteFromMenu();
  await act(() => Promise.resolve());

  expect(deleted).toEqual(["folder_1"]);
  const [message] = toasts;
  expect(message?.startsWith("Deleted “Reading list for the long")).toBe(true);
  expect(message?.endsWith("…”")).toBe(true);
  expect(Array.from(message ?? "").length).toBeLessThanOrEqual(50);
  // Long enough to reach Undo.
  expect(toastDurations).toEqual([10_000]);
});
