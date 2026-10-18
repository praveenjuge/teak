import { api } from "@teak/convex";
import type { Locator } from "../helpers/test";
import { DIALOG_EDITOR, getBlockEditor, goToEnd } from "./editor-library";
import { expect, generateTestContent, test } from "./fixtures";

const pill = (dialog: Locator, name: string) => dialog.getByRole("link", name);

test("[[ links a card: the pill follows a rename, opens the card, shows Missing card in Trash, and Linked from opens the note", async ({
  browser,
  screen,
  library,
}) => {
  const stamp = Date.now();
  const title = `Garden plan ${stamp}`;
  const targetId = await library.create(`${title}\n\nTomatoes by the fence.`);
  const noteId = await library.create(generateTestContent("Linking note"));

  const note = await library.open(noteId);
  await getBlockEditor(note);
  await goToEnd(browser, DIALOG_EDITOR);
  await browser.keyboard.type(` see [[${stamp}`);
  const menu = screen.getByRole("listbox", "Link a card");
  await expect(menu.getByRole("option", title)).toBeVisible({
    timeout: 15_000,
  });
  await browser.keyboard.press("Enter");
  await expect(pill(note, title)).toBeVisible();
  await expect
    .poll(() => library.read(noteId))
    .toContain(`[[${title}|teak:${targetId}]]`);

  await library.client.mutation(api.cards.updateCardField, {
    cardId: targetId,
    field: "content",
    value: `${title} renamed\n\nTomatoes by the fence.`,
  });
  await expect(pill(note, `${title} renamed`)).toBeVisible();

  await pill(note, `${title} renamed`).click();
  const target = screen.getByRole("dialog");
  await expect(target.getByText("Tomatoes by the fence.")).toBeVisible();
  const linkedFrom = target.getByRole("region", "Linked from");
  await expect(linkedFrom.getByRole("button", /Linking note/)).toBeVisible();

  await linkedFrom.getByRole("button", /Linking note/).click();
  await expect(
    pill(screen.getByRole("dialog"), `${title} renamed`)
  ).toBeVisible();

  await library.client.mutation(api.cards.updateCardField, {
    cardId: targetId,
    field: "delete",
  });
  await expect(
    screen.getByRole("dialog").getByText("Missing card")
  ).toBeVisible();
});

test("[[ with no matching card: Enter types a new line and closes the list", async ({
  browser,
  screen,
  library,
}) => {
  const noteId = await library.create(generateTestContent("No match note"));
  const note = await library.open(noteId);
  await getBlockEditor(note);
  await goToEnd(browser, DIALOG_EDITOR);
  await browser.keyboard.type(" [[zzqx-nomatch");
  const menu = screen.getByRole("listbox", "Link a card");
  await expect(screen.getByText("No matching cards")).toBeVisible({
    timeout: 15_000,
  });
  await browser.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await browser.keyboard.type("next line");
  await expect
    .poll(() => library.read(noteId))
    // The editor saves a typed `[[` escaped, as `\[\[`.
    .toMatch(/ \\?\[\\?\[zzqx-nomatch\n\nnext line$/);
});
