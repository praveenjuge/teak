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
      return Promise.resolve({ _id: "folder_1", ruleRunId: "run_2" });
    },
}));

let preview: unknown;
let lastRun: unknown = null;
mock.module("@/lib/convexQueryHooks", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") {
      return;
    }
    return getFunctionName(fn).endsWith("previewFolderRule")
      ? preview
      : lastRun;
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { FolderRulesDialog } = await import("../FolderRulesDialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  writes.length = 0;
  preview = undefined;
  lastRun = null;
});

const folder = (rules?: {
  autoFile: { enabled: boolean; query: string } | null;
  autoTags: string[];
}) => ({
  _id: "folder_1" as never,
  activeCardCount: 2,
  createdAt: 1,
  kind: "manual" as const,
  name: "Fonts",
  updatedAt: 1,
  ...(rules ? { rules, ruleRunId: "run_1" as never } : {}),
});

const onRunStarted = mock();

async function render(target = folder()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <FolderRulesDialog
        folder={target}
        onOpenChange={() => undefined}
        onRunStarted={onRunStarted}
        open
      />
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

async function typeInto(element: HTMLElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(() => {
    setValue?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const tagInput = () =>
  document.querySelector('input[placeholder="Tag to add"]') as HTMLInputElement;
const searchBox = () =>
  document.querySelector("textarea") as HTMLTextAreaElement;

describe("FolderRulesDialog", () => {
  test("opens with the folder's rules and the cards its search matches", async () => {
    preview = { matches: 3, capped: false };
    await render(
      folder({
        autoTags: ["type"],
        autoFile: { query: "tag:fonts", enabled: true },
      })
    );
    expect(text()).toContain("Rules for Fonts");
    expect(button("Remove type")).toBeDefined();
    expect(searchBox().value).toBe("tag:fonts");
    expect(text()).toContain("3 cards match");
    expect(button("Save")?.disabled).toBe(true);
  });

  test("says when the count covers only the newest cards", async () => {
    preview = { matches: 1, capped: true };
    await render(
      folder({ autoTags: [], autoFile: { query: "x", enabled: true } })
    );
    expect(text()).toContain("1 of your newest cards matches");
  });

  test("adds tags with Enter, warns about a hidden tag, and saves the rules", async () => {
    await render();
    await typeInto(tagInput(), "secret");
    await act(() => {
      tagInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(button("Remove secret")).toBeDefined();
    expect(text()).toContain(
      "Cards in this folder will be hidden from your library, because of the tag secret."
    );

    await act(async () => {
      button("Save")?.click();
      await Promise.resolve();
    });
    expect(writes).toEqual([
      {
        name: "folders:updateFolder",
        args: {
          folderId: "folder_1",
          autoTags: ["secret"],
          autoFileQuery: null,
        },
      },
    ]);
    expect(onRunStarted).toHaveBeenCalledWith({
      folderId: "folder_1",
      name: "Fonts",
      runId: "run_2",
    });
  });

  test("shows why a search can't be a rule and won't save it", async () => {
    preview = {
      error:
        "Folder rules can't use like: or mood:. Search by words, tags, type or site instead",
    };
    await render(
      folder({ autoTags: [], autoFile: { query: "mood:calm", enabled: true } })
    );
    await typeInto(searchBox(), "mood:calm ");
    expect(text()).toContain("Folder rules can't use like: or mood:");
    expect(button("Save")?.disabled).toBe(true);
  });

  test("offers to undo the last run while it can be undone", async () => {
    lastRun = {
      _id: "run_1",
      folderId: "folder_1",
      status: "done",
      filedCount: 4,
      taggedCount: 2,
      canUndo: true,
      createdAt: 1,
    };
    await render(folder({ autoTags: ["type"], autoFile: null }));
    expect(text()).toContain("Last run filed 4 cards and tagged 2 cards.");
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
