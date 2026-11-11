import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { getFunctionName } = await import("convex/server");
const { MAX_FOLDERS_PER_USER } = await import("@teak/convex/shared/folders");

const writes: string[] = [];
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: (fn: Parameters<typeof getFunctionName>[0]) =>
    Object.assign(
      () => {
        writes.push(getFunctionName(fn));
        return Promise.resolve({ _id: "folder_new", name: "Fonts" });
      },
      { withOptimisticUpdate: () => () => Promise.resolve(null) }
    ),
}));

let folders: unknown[] = [];
mock.module("@/lib/convexQueryHooks", () => ({
  useQuery: () => folders,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CardFoldersDialog } = await import("../CardFoldersDialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  writes.length = 0;
});

const foldersNamed = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    _id: `folder_${index}`,
    activeCardCount: 0,
    createdAt: 0,
    kind: "manual",
    name: `Folder ${index}`,
    updatedAt: 0,
  }));

async function searchFor(name: string) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <CardFoldersDialog
        cardId="card_1"
        folderIds={[]}
        onOpenChange={() => undefined}
        open
      />
    )
  );
  const input = document.querySelector("input") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

const createButton = () =>
  [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Create")
  );

test("offers to create a folder with a new name", async () => {
  folders = foldersNamed(2);
  await searchFor("Fonts");
  expect(createButton()?.textContent).toContain("Fonts");
});

test("does not offer a new folder once the account has the most folders", async () => {
  folders = foldersNamed(MAX_FOLDERS_PER_USER);
  const input = await searchFor("Fonts");
  expect(createButton()).toBeUndefined();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "You can have up to 500 folders"
  );

  await act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
  expect(writes).not.toContain("folders:createFolder");
});
