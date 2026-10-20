import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { LibrarySort } from "../../../lib/searchUrlState";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ViewMenu, viewMenuLabel } = await import("../ViewMenu");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function openMenu(
  options: { revisit?: "empty" | "ready"; sort?: LibrarySort } = {}
) {
  const onSortChange = mock((_sort: LibrarySort) => undefined);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <ViewMenu
        activeTypes={[]}
        onSortChange={onSortChange}
        revisit={options.revisit}
        sort={options.sort}
      />
    )
  );
  const trigger = document.querySelector("button");
  await act(() => {
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
  return { onSortChange };
}

const sortItems = () =>
  [...document.querySelectorAll('[role="menuitemradio"]')].map(
    (item) => item.textContent?.trim() ?? ""
  );

const revisitItem = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (item) => item.textContent?.startsWith("Revisit")
  );

describe("Revisit in the View menu", () => {
  test("is the last sort, after Shuffle", async () => {
    await openMenu({ revisit: "ready" });
    expect(sortItems()).toEqual([
      "Newest first",
      "Oldest first",
      "Shuffle",
      "Revisit",
    ]);
  });

  test("picking it asks for the revisit sort", async () => {
    const { onSortChange } = await openMenu({ revisit: "ready" });
    await act(() => revisitItem()?.click());
    expect(onSortChange).toHaveBeenCalledWith("revisit");
  });

  test("is left out where the view doesn't offer it (Archive, Trash)", async () => {
    await openMenu();
    expect(sortItems()).toEqual(["Newest first", "Oldest first", "Shuffle"]);
  });

  test("is disabled in an empty view, saying why", async () => {
    const { onSortChange } = await openMenu({ revisit: "empty" });
    const item = revisitItem();
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.textContent).toContain("Nothing to revisit here");
    await act(() => item?.click());
    expect(onSortChange).not.toHaveBeenCalled();
  });

  test("names the deck on the View button", () => {
    expect(viewMenuLabel([], "revisit")).toBe("View: revisiting");
    expect(viewMenuLabel(["image"], "revisit")).toBe("View: Image, revisiting");
  });
});
