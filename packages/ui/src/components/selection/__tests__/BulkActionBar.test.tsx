import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BulkActionBar } = await import("../BulkActionBar");
const { getToasterBottomOffset, isBulkActionBarVisible } = await import(
  "../../../lib/bulkActionBarPresence"
);

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderBar(
  selectedCount: number,
  onDelete = mock(),
  onCancel = mock()
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <BulkActionBar
        onCancel={onCancel}
        onDelete={onDelete}
        selectedCount={selectedCount}
      />
    )
  );
  return { onCancel, onDelete };
}

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

describe("BulkActionBar", () => {
  test("shows how many cards are selected", async () => {
    await renderBar(1);
    expect(document.body.textContent).toContain("1 card selected");
    await act(() => root?.unmount());

    await renderBar(2);
    expect(document.body.textContent).toContain("2 cards selected");
  });

  test("asks for confirmation before deleting", async () => {
    const { onDelete } = await renderBar(2);

    await act(() => button("Delete").click());
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Delete 2 cards?");

    await act(() => button("Delete 2 cards").click());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("does not delete when the confirmation is cancelled", async () => {
    const { onDelete, onCancel } = await renderBar(3);

    await act(() => button("Delete").click());
    const dialog = document.querySelector('[role="alertdialog"]');
    const cancel = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent?.trim() === "Cancel"
    );
    expect(cancel).toBeDefined();
    await act(() => cancel?.click());

    expect(onDelete).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("disables delete when nothing is selected", async () => {
    await renderBar(0);
    expect(button("Delete").disabled).toBe(true);
  });

  test("lifts bottom toasts above the bar only while it is visible", async () => {
    expect(isBulkActionBarVisible()).toBe(false);
    expect(getToasterBottomOffset(isBulkActionBarVisible())).toBe(0);

    await renderBar(1);
    expect(isBulkActionBarVisible()).toBe(true);
    expect(getToasterBottomOffset(isBulkActionBarVisible())).toBeGreaterThan(0);

    await act(() => root?.unmount());
    root = undefined;
    expect(isBulkActionBarVisible()).toBe(false);
  });
});
