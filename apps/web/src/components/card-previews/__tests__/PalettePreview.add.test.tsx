import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { PalettePreview } = await import("../PalettePreview");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const palette = (hexes: string[]) =>
  ({
    _id: "card_palette",
    _creationTime: 0,
    colors: hexes.map((hex) => ({ hex })),
    content: "Brand colors",
    createdAt: 0,
    type: "palette",
    updatedAt: 0,
    userId: "user_1",
  }) as any;

const render = (
  hexes: string[],
  onAddColor: (hex: string) => Promise<boolean>
) => {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  return act(() =>
    root?.render(
      <PalettePreview card={palette(hexes)} onAddColor={onAddColor} />
    )
  );
};

const hexField = () =>
  document.querySelector<HTMLInputElement>("input[aria-label='Hex code']");

const typeHex = (value: string) => {
  const input = hexField();
  if (!input) {
    throw new Error("The hex field isn't open");
  }
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

test("adding the first color keeps the open popover and its typed color", async () => {
  let finishSave: (saved: boolean) => void = () => undefined;
  const onAddColor = mock(
    () =>
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      })
  );
  await render([], onAddColor);

  const addButton = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Add color"
  );
  await act(() => {
    addButton?.click();
  });
  await act(() => {
    typeHex("2a9d8f");
  });
  await act(() => {
    hexField()?.form?.requestSubmit();
  });
  expect(onAddColor).toHaveBeenCalledWith("#2A9D8F");

  // The optimistic update shows the color before the save settles.
  await render(["#2A9D8F"], onAddColor);
  expect(hexField()?.value).toBe("2a9d8f");

  // The save fails and the color goes away again: the typed color is still there.
  await act(async () => {
    finishSave(false);
    await Promise.resolve();
  });
  await render([], onAddColor);
  expect(hexField()?.value).toBe("2a9d8f");
});
