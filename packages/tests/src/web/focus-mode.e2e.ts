import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { getBlockEditor, goToEnd } from "./editor-library";
import { expect, generateTestContent, test } from "./fixtures";

interface CardRow {
  _id: Id<"cards">;
  content: string;
}

const FOCUS_EDITOR =
  '[data-focus-editor] [role="textbox"][aria-label="Markdown content"]';

test("Focus on an existing note: write, leave with Esc, and the edit saves", async ({
  browser,
  screen,
  library,
}) => {
  const marker = generateTestContent("Focus note");
  const id = await library.create(marker);
  const cardDialog = await library.open(id);

  // Cmd/Ctrl+E anywhere in the open card enters Focus.
  await browser.keyboard.press("ControlOrMeta+e");
  const focus = screen.getByRole("dialog", "Focus");
  await expect(focus).toBeVisible();
  const focusEditor = await getBlockEditor(focus);
  await goToEnd(browser, FOCUS_EDITOR);
  await focusEditor.pressSequentially(" written in focus");

  // Esc leaves Focus only: the card stays open with the edit, and it saves.
  await browser.keyboard.press("Escape");
  await expect(focus).toBeHidden();
  await expect(cardDialog).toBeVisible();
  await expect(cardDialog.getByRole("textbox", "Markdown content")).toHaveText(
    `${marker} written in focus`
  );
  await expect(cardDialog.getByRole("button", "Focus")).toBeFocused();
  await expect.poll(() => library.read(id)).toBe(`${marker} written in focus`);

  // The Focus button, then Save in the bar.
  await cardDialog.getByRole("button", "Focus").click();
  await expect(focus).toBeVisible();
  await goToEnd(browser, FOCUS_EDITOR);
  await (await getBlockEditor(focus)).pressSequentially(" again");
  // "Focus note content <time>" plus four more words.
  await expect(focus.getByText("8 words")).toBeVisible();
  await focus.getByRole("button", "Save", { exact: false }).click();
  await expect
    .poll(() => library.read(id))
    .toBe(`${marker} written in focus again`);

  // Esc with the link editor open closes only the link editor.
  await goToEnd(browser, FOCUS_EDITOR);
  await browser.keyboard.press("Shift+ArrowLeft");
  await browser.keyboard.press("ControlOrMeta+k");
  await expect(screen.getByRole("textbox", "Link URL")).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("textbox", "Link URL")).toBeHidden();
  await expect(focus).toBeVisible();

  // So does Esc with the slash menu open.
  await goToEnd(browser, FOCUS_EDITOR);
  await browser.keyboard.press("Enter");
  await browser.keyboard.type("/");
  const slashMenu = screen.getByRole("listbox", "Formatting commands");
  await expect(slashMenu).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(slashMenu).toBeHidden();
  await expect(focus).toBeVisible();

  // Cmd/Ctrl+E inside Focus leaves it too.
  await (await getBlockEditor(focus)).focus();
  await browser.keyboard.press("ControlOrMeta+e");
  await expect(focus).toBeHidden();
  await expect(cardDialog).toBeVisible();
});

test("the composer's Focus is the same Focus, and Save creates the card", async ({
  browser,
  screen,
  library,
}) => {
  const marker = generateTestContent("Focus composer");
  const composer = screen.getByRole("group", "Markdown content editor");
  const listCards = async () =>
    (await library.client.query(api.cards.getCards, {})) as CardRow[];
  const before = new Set((await listCards()).map((card) => card._id));
  const blocks = await getBlockEditor(composer);
  await blocks.fill(marker);
  await expect(screen.getByRole("button", "Focus")).toBeVisible();

  await blocks.press("ControlOrMeta+e");
  const focus = screen.getByRole("dialog", "Focus");
  await expect(focus).toBeVisible();
  await goToEnd(browser, FOCUS_EDITOR);
  await (await getBlockEditor(focus)).pressSequentially(" finished");
  // After a pause, the word count: "Focus composer content <time> finished".
  await expect(focus.getByText("5 words")).toBeVisible();

  await focus.getByRole("button", "Save", { exact: false }).click();
  await expect(focus).toBeHidden();
  await expect(
    screen.getByRole("main").getByText(`${marker} finished`, { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  const created = async () =>
    (await listCards()).filter((card) => !before.has(card._id));
  await expect
    .poll(async () => (await created()).map((card) => card.content))
    .toEqual([`${marker} finished`]);
  library.ids.push(...(await created()).map((card) => card._id));
});
