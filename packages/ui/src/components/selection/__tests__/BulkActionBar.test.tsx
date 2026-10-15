import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BulkActionBar } = await import("../BulkActionBar");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderBar(
  selectedCount: number,
  options: {
    addToFolder?: { id: string; name: string };
    allFavorited?: boolean;
    folder?: { id: string; name: string };
    isBusy?: boolean;
    view?: "library" | "archive" | "trash";
  } = {},
  onAction = mock(),
  onCancel = mock()
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <BulkActionBar
        addToFolder={options.addToFolder}
        allFavorited={options.allFavorited}
        folder={options.folder}
        isBusy={options.isBusy}
        onAction={onAction}
        onCancel={onCancel}
        selectedCount={selectedCount}
        view={options.view}
      />
    )
  );
  return { onAction, onCancel };
}

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === name ||
      element.getAttribute("aria-label") === name
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

async function openMoreMenu() {
  const trigger = button("More actions");
  await act(() => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
}

function itemName(element: Element) {
  const key = element.querySelector('[data-slot="dropdown-menu-shortcut"]');
  return element.textContent?.replace(key?.textContent ?? "", "").trim();
}

function menuItem(name: string) {
  const match = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => itemName(element) === name
  );
  expect(match).toBeDefined();
  return match as HTMLElement;
}

describe("BulkActionBar", () => {
  test("shows how many cards are selected", async () => {
    await renderBar(1);
    expect(document.body.textContent).toContain("1 card selected");
    await act(() => root?.unmount());

    await renderBar(300);
    expect(document.body.textContent).toContain("300 cards selected");
  });

  test("archives from the library and keeps the rest in More", async () => {
    const { onAction } = await renderBar(3);
    await act(() => button("Archive").click());
    expect(onAction).toHaveBeenCalledWith("archive");

    await openMoreMenu();
    const items = [...document.querySelectorAll('[role="menuitem"]')].map(
      (element) => [
        itemName(element),
        element.getAttribute("aria-keyshortcuts"),
      ]
    );
    expect(items).toEqual([
      ["Add to favorites", "F"],
      ["Remove from favorites", null],
      ["Add tags…", "T"],
      ["Remove tags…", null],
      ["Copy links", null],
      ["Add to folder…", null],
      ["Move to folder…", null],
      ["Move to Trash", expect.stringMatching(/^(Delete|Backspace)$/)],
    ]);
    await act(() => menuItem("Move to Trash").click());
    expect(onAction).toHaveBeenLastCalledWith("delete");
  });

  test("E archives the selection, as its button says", async () => {
    await renderBar(3);
    expect(button("Archive").getAttribute("aria-keyshortcuts")).toBe("E");
  });

  test("when every selected card is a favorite, F removes them", async () => {
    await renderBar(2, { allFavorited: true });
    await openMoreMenu();
    expect(
      menuItem("Remove from favorites").getAttribute("aria-keyshortcuts")
    ).toBe("F");
    expect(
      menuItem("Add to favorites").getAttribute("aria-keyshortcuts")
    ).toBeNull();
  });

  test("inside a folder, More can take cards out of it", async () => {
    const { onAction } = await renderBar(2, {
      folder: { id: "f1", name: "Reading" },
    });
    await openMoreMenu();
    await act(() => menuItem("Remove from Reading").click());
    expect(onAction).toHaveBeenLastCalledWith("removeFromFolder");
  });

  test("picking cards for a folder makes adding them the main action", async () => {
    const { onAction } = await renderBar(3, {
      addToFolder: { id: "f1", name: "Reading" },
    });
    await act(() => button("Add to Reading").click());
    expect(onAction).toHaveBeenCalledWith("addToFolder");
  });

  test("offers Unarchive in Archive and only Restore in Trash", async () => {
    const archive = await renderBar(2, { view: "archive" });
    await act(() => button("Unarchive").click());
    expect(archive.onAction).toHaveBeenCalledWith("unarchive");
    await act(() => root?.unmount());

    const trash = await renderBar(2, { view: "trash" });
    await act(() => button("Restore").click());
    expect(trash.onAction).toHaveBeenCalledWith("restore");
    expect(
      [...document.querySelectorAll("button")].some(
        (element) => element.getAttribute("aria-label") === "More actions"
      )
    ).toBe(false);
  });

  test("waits while nothing is selected or an action is running", async () => {
    await renderBar(0);
    expect(button("Archive").disabled).toBe(true);
    await act(() => root?.unmount());

    await renderBar(4, { isBusy: true });
    expect(button("Archive").disabled).toBe(true);
    expect(button("More actions").disabled).toBe(true);
  });

  test("cancels the selection", async () => {
    const { onCancel } = await renderBar(2);
    await act(() => button("Cancel selection").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
