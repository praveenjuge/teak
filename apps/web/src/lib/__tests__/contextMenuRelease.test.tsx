import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  CONTEXT_MENU_RELEASE_GRACE_MS,
  isMenuOpeningRelease,
  resetContextMenuReleaseForTests,
} = await import("../contextMenuRelease");
const { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } =
  await import("../../components/ui/context-menu");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  resetContextMenuReleaseForTests();
});

describe("isMenuOpeningRelease", () => {
  test("a right-button release never picks an item", () => {
    expect(isMenuOpeningRelease({ button: 2, at: 5000 }, 0)).toBe(true);
    expect(isMenuOpeningRelease({ button: 2, at: 5000 }, null)).toBe(true);
  });

  test("any release right after the menu opens is the opening press", () => {
    expect(isMenuOpeningRelease({ button: 0, at: 1100 }, 1000)).toBe(true);
    expect(
      isMenuOpeningRelease(
        { button: 0, at: 1000 + CONTEXT_MENU_RELEASE_GRACE_MS },
        1000
      )
    ).toBe(false);
  });

  test("a left click after the grace period, or with no menu opened, counts", () => {
    expect(isMenuOpeningRelease({ button: 0, at: 5000 }, 1000)).toBe(false);
    expect(isMenuOpeningRelease({ button: 0, at: 5000 }, null)).toBe(false);
  });
});

describe("context menu items ignore the release that opened the menu", () => {
  async function openMenu(onSelect: () => void) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(() =>
      root?.render(
        <ContextMenu>
          <ContextMenuTrigger>Card</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={onSelect}>Select</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    );
    const trigger = container.firstElementChild as HTMLElement;
    await act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 2 })
      );
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
        })
      );
    });
    const item = document.querySelector<HTMLElement>("[role='menuitem']");
    expect(item).not.toBeNull();
    return item as HTMLElement;
  }

  const release = async (item: HTMLElement, button: number) => {
    await act(() => {
      item.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button })
      );
    });
  };

  test("releasing the right button over an item that landed under the pointer runs nothing", async () => {
    const onSelect = mock();
    const item = await openMenu(onSelect);
    await release(item, 2);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).not.toBeNull();
  });

  test("a left release in the instant the menu opens (Control-click) runs nothing", async () => {
    const onSelect = mock();
    const item = await openMenu(onSelect);
    await release(item, 0);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).not.toBeNull();
  });

  test("a real click on an item still runs it", async () => {
    const onSelect = mock();
    const item = await openMenu(onSelect);
    await act(() => {
      item.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
