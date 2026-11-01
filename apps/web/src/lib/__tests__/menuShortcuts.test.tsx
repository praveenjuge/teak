import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { matchesMenuShortcut } = await import("../menuShortcuts");
const {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} = await import("../../components/ui/dropdown-menu");
const { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } =
  await import("../../components/ui/context-menu");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("matchesMenuShortcut", () => {
  const key = (value: string, modifiers: Partial<KeyboardEvent> = {}) => ({
    altKey: false,
    ctrlKey: false,
    key: value,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  });

  test.each([
    ["F", key("f"), true],
    ["F", key("F"), true],
    ["F", key("t"), false],
    ["F", key("f", { metaKey: true }), false],
    ["Control+C", key("c", { ctrlKey: true }), true],
    ["Control+C", key("c"), false],
    ["Control+C", key("c", { metaKey: true }), false],
    ["Meta+C", key("c", { metaKey: true }), true],
    ["Delete", key("Delete"), true],
    ["Delete", key("Backspace"), true],
    ["Backspace", key("Delete"), true],
    ["Delete", key("d"), false],
  ] as const)("matches %p against %o: %p", (keys, event, expected) => {
    expect(matchesMenuShortcut(keys, event)).toBe(expected);
  });
});

const keydown = async (target: Element, init: KeyboardEventInit) => {
  await act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
    );
  });
};

describe("menus run the shortcuts their items list", () => {
  const items = (
    onNote: () => void,
    onUpload: () => void,
    onOther: () => void
  ) => ({
    note: { keys: "N", onSelect: onNote },
    upload: { keys: "U", onSelect: onUpload },
    other: { onSelect: onOther },
  });

  async function renderDropdown(
    spies: ReturnType<typeof items>,
    { uploadDisabled = false } = {}
  ) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(() =>
      root?.render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              aria-keyshortcuts={spies.note.keys}
              onSelect={spies.note.onSelect}
            >
              Note
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-keyshortcuts={spies.upload.keys}
              disabled={uploadDisabled}
              onSelect={spies.upload.onSelect}
            >
              Upload
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={spies.other.onSelect}>
              Nothing listed
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    );
    const trigger = container.querySelector("button") as HTMLElement;
    await keydown(trigger, { key: "Enter" });
    const menu = document.querySelector<HTMLElement>("[role='menu']");
    expect(menu).not.toBeNull();
    return menu as HTMLElement;
  }

  test("a dropdown item's key picks it and closes the menu", async () => {
    const spies = items(mock(), mock(), mock());
    const menu = await renderDropdown(spies);
    await keydown(menu, { key: "u" });
    expect(spies.upload.onSelect).toHaveBeenCalledTimes(1);
    expect(spies.note.onSelect).not.toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).toBeNull();
  });

  test("keys no item lists, or with extra modifiers, are left to the menu", async () => {
    const spies = items(mock(), mock(), mock());
    const menu = await renderDropdown(spies);
    await keydown(menu, { key: "z" });
    await keydown(menu, { key: "n", metaKey: true });
    expect(spies.note.onSelect).not.toHaveBeenCalled();
    expect(spies.other.onSelect).not.toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).not.toBeNull();
  });

  test("a disabled item's key does nothing", async () => {
    const spies = items(mock(), mock(), mock());
    const menu = await renderDropdown(spies, { uploadDisabled: true });
    await keydown(menu, { key: "u" });
    expect(spies.upload.onSelect).not.toHaveBeenCalled();
  });

  test("a context menu item's key picks it", async () => {
    const onSelect = mock();
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(() =>
      root?.render(
        <ContextMenu>
          <ContextMenuTrigger>Area</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem aria-keyshortcuts="Delete" onSelect={onSelect}>
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    );
    await act(() => {
      container.firstElementChild?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
      );
    });
    const menu = document.querySelector<HTMLElement>("[role='menu']");
    expect(menu).not.toBeNull();
    await keydown(menu as HTMLElement, { key: "Backspace" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role='menu']")).toBeNull();
  });
});
