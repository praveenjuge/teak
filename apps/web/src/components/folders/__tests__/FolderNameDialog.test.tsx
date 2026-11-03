import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { getFunctionName } = await import("convex/server");

const writes: { args: unknown; name: string }[] = [];
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation:
    (fn: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
      writes.push({ name: getFunctionName(fn), args });
      return Promise.resolve({
        _id: "folder_1",
        name: "Fonts",
        ruleRunId: "run_2",
      });
    },
}));

let preview: unknown;
let lastRun: unknown = null;
mock.module("@/lib/convexQueryHooks", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") {
      return;
    }
    const name = getFunctionName(fn);
    if (name.endsWith("listFolders")) {
      return [];
    }
    return name.endsWith("previewFolderRule") ? preview : lastRun;
  },
}));

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((message: string) => toasts.push(message), {
    dismiss: () => undefined,
    error: (message: string) => toasts.push(message),
    loading: (message: string) => toasts.push(message),
    success: (message: string) => toasts.push(message),
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { FolderNameDialog } = await import("../FolderNameDialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  writes.length = 0;
  toasts.length = 0;
  preview = undefined;
  lastRun = null;
});

interface Rules {
  autoFile: { enabled: boolean; query: string } | null;
  autoTags: string[];
}

const folder = (rules?: Rules, kind: "manual" | "smart" = "manual") => ({
  _id: "folder_1" as never,
  activeCardCount: 2,
  createdAt: 1,
  kind,
  name: "Fonts",
  updatedAt: 1,
  ...(kind === "smart" ? { query: "tag:fonts" } : {}),
  ...(rules ? { rules, ruleRunId: "run_1" as never } : {}),
});

async function render(target: ReturnType<typeof folder> | null = folder()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <FolderNameDialog folder={target} onOpenChange={() => undefined} open />
    )
  );
}

const text = () => document.body.textContent ?? "";
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) =>
      element.textContent === name ||
      element.getAttribute("aria-label") === name
  ) as HTMLButtonElement | undefined;
const labelled = (label: string) => {
  const target = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === label
  );
  return document.getElementById(
    target?.getAttribute("for") ?? ""
  ) as HTMLInputElement;
};

async function typeInto(element: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const press = (element: HTMLElement, key: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

const save = () =>
  act(async () => {
    button("Save")?.click();
    await Promise.resolve();
  });

describe("FolderNameDialog rules", () => {
  test("editing a folder shows its rules and the cards its search matches", async () => {
    preview = { matches: 3, capped: false };
    await render(
      folder({
        autoTags: ["type"],
        autoFile: { query: "tag:fonts", enabled: true },
      })
    );
    expect(text()).toContain("Edit folder");
    expect(button("Remove type")).toBeDefined();
    expect(labelled("Auto-file cards that match").value).toBe("tag:fonts");
    expect(text()).toContain("3 cards match");
    expect(button("Save")?.disabled).toBe(true);
  });

  test("a new folder and a smart folder have no rules", async () => {
    await render(null);
    expect(text()).toContain("New folder");
    expect(text()).not.toContain("Add these tags");

    await act(() => root?.unmount());
    document.body.innerHTML = "";
    await render(folder(undefined, "smart"));
    expect(text()).not.toContain("Add these tags");
  });

  test("saves the name and the rules in one change, then follows the run", async () => {
    await render();
    const tags = labelled("Add these tags");
    await typeInto(tags, "secret");
    await press(tags, "Enter");
    expect(button("Remove secret")).toBeDefined();
    expect(text()).toContain(
      "Cards in this folder will be hidden from your library, because of the tag secret."
    );
    await typeInto(tags, "later");
    await typeInto(labelled("Name"), "Type");

    await save();
    expect(writes).toEqual([
      {
        name: "folders:updateFolder",
        args: {
          folderId: "folder_1",
          name: "Type",
          color: null,
          autoTags: ["secret", "later"],
          autoFileQuery: null,
        },
      },
    ]);
  });

  test("renaming alone leaves the rules out of the change", async () => {
    await render(folder({ autoTags: ["type"], autoFile: null }));
    await typeInto(labelled("Name"), "Type");
    await save();
    expect(writes).toEqual([
      {
        name: "folders:updateFolder",
        args: { folderId: "folder_1", name: "Type", color: null },
      },
    ]);
  });

  test("Backspace in an empty tag field takes off the last tag", async () => {
    await render(folder({ autoTags: ["type", "later"], autoFile: null }));
    await press(labelled("Add these tags"), "Backspace");
    expect(button("Remove later")).toBeUndefined();
    expect(button("Remove type")).toBeDefined();
  });

  test("shows why a search can't be a rule and won't save it", async () => {
    preview = {
      error:
        "Folder rules can't use like: or mood:. Search by words, tags, type or site instead",
    };
    await render(
      folder({ autoTags: [], autoFile: { query: "mood:calm", enabled: true } })
    );
    await typeInto(labelled("Auto-file cards that match"), "mood:calm ");
    expect(text()).toContain("Folder rules can't use like: or mood:");
    expect(button("Save")?.disabled).toBe(true);
  });

  test("says only what the last run did, and offers to undo it", async () => {
    lastRun = {
      _id: "run_1",
      folderId: "folder_1",
      status: "done",
      filedCount: 0,
      taggedCount: 2,
      canUndo: true,
      createdAt: 1,
    };
    await render(folder({ autoTags: ["type"], autoFile: null }));
    expect(text()).toContain("Last run tagged 2 cards.");
    expect(text()).not.toContain("filed");
    await act(async () => {
      button("Undo last run")?.click();
      await Promise.resolve();
    });
    expect(writes).toEqual([
      {
        name: "folders:undoFolderRuleRun",
        args: { folderId: "folder_1", runId: "run_1" },
      },
    ]);
  });
});
