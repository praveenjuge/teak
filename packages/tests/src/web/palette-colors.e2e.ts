import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import type { EditorLibrary } from "./editor-library";
import { expect, test } from "./fixtures";

const savePalette = async (library: EditorLibrary, hexes: string[]) => {
  const cardId = await library.client.mutation(api.cards.createCard, {
    content: `Palette ${Date.now()}`,
    type: "palette",
    colors: hexes.map((hex) => ({ hex })),
  });
  library.ids.push(cardId);
  return cardId;
};

test("a color is added from the hex field and removed with Undo", async ({
  browser,
  screen,
  library,
}) => {
  const cardId = await savePalette(library, ["#E63946", "#F1FAEE"]);
  const savedHexes = async () =>
    (
      (await library.client.query(api.cards.getCard, { id: cardId }))?.colors ??
      []
    ).map((color: { hex: string }) => color.hex);

  await gotoApp(browser, `/?card=${cardId}`);
  const dialog = screen.getByRole("dialog", "Palette");
  await dialog.getByRole("button", "Add color").click();
  const hexField = screen.getByRole("textbox", "Hex code");
  await hexField.fill("teal-ish");
  await expect(
    screen.getByText("Enter a hex code, such as #FF5500")
  ).toBeVisible();
  await expect(screen.getByRole("button", "Add")).toBeDisabled();

  await hexField.fill("e63946");
  await expect(
    screen.getByText("#E63946 is already in this palette")
  ).toBeVisible();

  await hexField.fill("2a9d8f");
  await hexField.press("Enter");
  await expect(dialog.getByRole("button", "Copy #2A9D8F")).toBeVisible();
  await expect.poll(savedHexes).toEqual(["#E63946", "#F1FAEE", "#2A9D8F"]);

  await dialog.getByRole("button", "Remove #F1FAEE").click();
  await expect(dialog.getByRole("button", "Copy #F1FAEE")).toBeHidden();
  await expect.poll(savedHexes).toEqual(["#E63946", "#2A9D8F"]);
  await screen.getByRole("button", "Undo").click();
  await expect(dialog.getByRole("button", "Copy #F1FAEE")).toBeVisible();
  await expect.poll(savedHexes).toEqual(["#E63946", "#2A9D8F", "#F1FAEE"]);
});

test("a color saved with alpha is removed by its RGB, and Undo restores it", async ({
  browser,
  screen,
  library,
}) => {
  const cardId = await savePalette(library, ["#FF000080", "#00FF00"]);
  await gotoApp(browser, `/?card=${cardId}`);
  const dialog = screen.getByRole("dialog", "Palette");
  await dialog.getByRole("button", "Remove #FF000080").click();
  await expect(dialog.getByRole("button", "Copy #FF000080")).toBeHidden();
  await expect(screen.getByText("Removed #FF0000")).toBeVisible();
  await expect
    .poll(async () =>
      (
        (await library.client.query(api.cards.getCard, { id: cardId }))
          ?.colors ?? []
      ).map((color: { hex: string }) => color.hex)
    )
    .toEqual(["#00FF00"]);

  await screen.getByRole("button", "Undo").click();
  await expect(dialog.getByRole("button", "Copy #FF000080")).toBeVisible();
  await expect
    .poll(async () =>
      (
        (await library.client.query(api.cards.getCard, { id: cardId }))
          ?.colors ?? []
      ).map((color: { hex: string }) => color.hex)
    )
    .toEqual(["#00FF00", "#FF000080"]);
});

test("a full palette has no Add color, and a one-color palette nothing to remove", async ({
  browser,
  screen,
  library,
}) => {
  const twelve = Array.from(
    { length: 12 },
    (_, index) => `#0000${index.toString(16).padStart(2, "0").toUpperCase()}`
  );
  const fullId = await savePalette(library, twelve);
  await gotoApp(browser, `/?card=${fullId}`);
  const dialog = screen.getByRole("dialog", "Palette");
  await expect(dialog.getByRole("button", "Copy #00000B")).toBeVisible();
  await expect(dialog.getByRole("button", "Add color")).toBeHidden();
  await expect(dialog.getByRole("button", "Remove #00000B")).toBeVisible();

  const singleId = await savePalette(library, ["#E63946"]);
  await gotoApp(browser, `/?card=${singleId}`);
  await expect(dialog.getByRole("button", "Copy #E63946")).toBeVisible();
  await expect(dialog.getByRole("button", "Add color")).toBeVisible();
  await expect(dialog.getByRole("button", "Remove #E63946")).toBeHidden();
});
