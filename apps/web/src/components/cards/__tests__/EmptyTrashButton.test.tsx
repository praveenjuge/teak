import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(
    (message: string) => {
      toasts.push(message);
    },
    { error: () => undefined, success: () => undefined }
  ),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TRASH_COUNT_LIMIT } = await import("@teak/convex/shared/constants");
const { requestEmptyTrash } = await import("@/lib/commandPalette");
const { EmptyTrashControl } = await import("../EmptyTrashButton");

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
  toasts.length = 0;
});

async function render(count: number | undefined, onEmpty = () => undefined) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(<EmptyTrashControl count={count} onEmpty={onEmpty} />)
  );
}

const button = () =>
  [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("Empty Trash")
  ) as HTMLButtonElement;
const dialog = () => document.querySelector('[role="alertdialog"]');
const confirmButton = () =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === "Empty Trash"
  ) as HTMLButtonElement;

describe("EmptyTrashControl", () => {
  test("is disabled while Trash is empty or its count is loading", async () => {
    await render(0);
    expect(button().disabled).toBe(true);
    await act(() => root?.unmount());
    root = undefined;
    await render(undefined);
    expect(button().disabled).toBe(true);
  });

  test("asks with the count and that it can't be undone, then empties", async () => {
    const onEmpty = mock();
    await render(3, onEmpty);
    expect(button().disabled).toBe(false);

    await act(async () => {
      button().click();
      await Promise.resolve();
    });
    expect(dialog()?.textContent).toContain("Empty Trash?");
    expect(dialog()?.textContent).toContain(
      "This permanently deletes 3 cards and their files. This can’t be undone."
    );
    expect(onEmpty).not.toHaveBeenCalled();

    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  test("says 'or more' when Trash holds the most the count reads", async () => {
    await render(TRASH_COUNT_LIMIT);
    await act(async () => {
      button().click();
      await Promise.resolve();
    });
    expect(dialog()?.textContent).toContain(
      `This permanently deletes ${TRASH_COUNT_LIMIT} or more cards`
    );
  });

  test("the command palette's Empty Trash opens the confirmation", async () => {
    await render(2);
    await act(async () => {
      expect(requestEmptyTrash()).toBe(true);
      await Promise.resolve();
    });
    expect(dialog()?.textContent).toContain("2 cards");
  });

  test("the command palette's Empty Trash says so when Trash is empty", async () => {
    await render(0);
    await act(async () => {
      requestEmptyTrash();
      await Promise.resolve();
    });
    expect(dialog()).toBeNull();
    expect(toasts).toEqual(["Trash is empty."]);
  });
});
