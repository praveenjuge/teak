import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// The library from the keyboard: `/` search, moving through the grid, the
// single-key card actions, `g` sequences, the shortcuts list and `N`. The
// three cards share a tag, and the page shows only that tag (newest first),
// so the grid reads: composer, third, second, first.
const FIRST = "Keyboard card one";
const SECOND = "Keyboard card two";
const THIRD = "Keyboard card three";
const TAG = "keyboard-pass";

const pathOf = async (url: Promise<string>) => new URL(await url).pathname;

test("the library works from the keyboard", async ({
  browser,
  screen,
  library,
}) => {
  for (const content of [FIRST, SECOND, THIRD]) {
    library.ids.push(
      await library.client.mutation(api.cards.createCard, {
        content,
        type: "text",
        tags: [TAG],
      })
    );
  }
  // A card button is named for its type and title ("Text: …").
  const card = (title: string) =>
    screen.getByRole("button", `Text: ${title}`, { exact: false });
  const press = (key: string) => browser.keyboard.press(key);

  await gotoApp(browser, `/?tag=${TAG}`);
  await expect(card(FIRST)).toBeVisible({ timeout: 30_000 });

  // `/` focuses search; typed shortcut keys are only text there.
  const search = screen.getByRole("combobox");
  await press("/");
  await expect(search).toBeFocused();
  await search.pressSequentially("g t");
  expect(await pathOf(browser.url())).toBe("/");
  await search.fill("");

  // With nothing focused, J enters the grid at its one tab stop.
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });
  await press("j");
  await expect(card(THIRD)).toBeFocused();
  await expect(card(THIRD)).toHaveAttribute("tabindex", "0");
  await expect(card(SECOND)).toHaveAttribute("tabindex", "-1");

  // Arrows move to the card beside; J and K step in order.
  await press("ArrowRight");
  await expect(card(SECOND)).toBeFocused();
  await expect(card(SECOND)).toHaveAttribute("tabindex", "0");
  await expect(card(THIRD)).toHaveAttribute("tabindex", "-1");
  await press("ArrowLeft");
  await expect(card(THIRD)).toBeFocused();
  await press("j");
  await expect(card(SECOND)).toBeFocused();
  await press("k");
  await expect(card(THIRD)).toBeFocused();

  // Enter opens the card; Escape closes it and focus comes back.
  await press("Enter");
  await expect(screen.getByRole("dialog")).toBeVisible();
  await press("Escape");
  await expect(screen.getByRole("dialog")).toBeHidden();
  await expect(card(THIRD)).toBeFocused();

  // X selects; Escape clears the selection.
  await press("x");
  await press("j");
  await press("x");
  await expect(
    screen.getByText("2 cards selected", { exact: false })
  ).toBeVisible();
  await press("Escape");
  await expect(
    screen.getByText("2 cards selected", { exact: false })
  ).toBeHidden();

  // Delete moves to Trash and focus moves on; Undo is reachable from the
  // keyboard.
  await expect(card(SECOND)).toBeFocused();
  await press("Delete");
  await expect(
    screen.getByText("Moved 1 card to Trash", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(card(SECOND)).toBeHidden();
  await expect(card(FIRST)).toBeFocused();
  await press("Alt+t");
  await press("Tab");
  await press("Tab");
  expect(
    await browser.evaluate(() => {
      const focused = document.activeElement;
      return `${focused?.textContent} in ${focused?.closest("li")?.textContent}`;
    })
  ).toContain("Undo in Moved 1 card to Trash");
  await press("Enter");
  await expect(card(SECOND)).toBeVisible({ timeout: 30_000 });

  // F favorites the focused card; E archives one, and focus moves on.
  await card(SECOND).focus();
  await press("f");
  await press("k");
  await expect(card(THIRD)).toBeFocused();
  await press("e");
  await expect(card(THIRD)).toBeHidden({ timeout: 30_000 });
  await expect(card(SECOND)).toBeFocused();

  // `?` lists the shortcuts; `/` there closes it and lands in search.
  await press("?");
  await expect(screen.getByRole("dialog", "Keyboard shortcuts")).toBeVisible();
  await press("/");
  await expect(screen.getByRole("dialog", "Keyboard shortcuts")).toBeHidden();
  await expect(search).toBeFocused();
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });

  // A `g` sequence in the list closes it and goes.
  await press("?");
  const shortcuts = screen.getByRole("dialog", "Keyboard shortcuts");
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByText("Move to Trash")).toBeVisible();
  await press("g");
  await press("f");
  await expect.poll(() => pathOf(browser.url())).toBe("/favorites");
  await expect(shortcuts).toBeHidden();
  await expect(card(SECOND)).toBeVisible({ timeout: 30_000 });
  await expect(card(FIRST)).toBeHidden();
  await press("g");
  await press("a");
  await expect.poll(() => pathOf(browser.url())).toBe("/archive");
  await expect(card(THIRD)).toBeVisible({ timeout: 30_000 });

  // N, away from Everything, opens it with the composer ready to type.
  await press("n");
  await expect.poll(() => pathOf(browser.url())).toBe("/");
  await expect(
    screen.getByRole("textbox", "Markdown content", { exact: false })
  ).toBeFocused({ timeout: 30_000 });

  // U opens the file picker, as the sidebar's Upload files does. (Last:
  // the picker takes focus from the page.)
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });
  await press("u");
  expect(
    await browser.evaluate(
      () => document.querySelectorAll("body > input[type='file']").length
    )
  ).toBe(1);
});
