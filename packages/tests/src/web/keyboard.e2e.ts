import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

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
  const card = (title: string) =>
    screen.getByRole("button", `Text: ${title}`, { exact: false });
  const press = (key: string) => browser.keyboard.press(key);

  await gotoApp(browser, `/?tag=${TAG}`);
  await expect(card(FIRST)).toBeVisible({ timeout: 30_000 });

  const search = screen.getByRole("combobox");
  await press("/");
  await expect(search).toBeFocused();
  await search.pressSequentially("g t");
  expect(await pathOf(browser.url())).toBe("/");
  await search.fill("");

  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });
  await press("j");
  await expect(card(THIRD)).toBeFocused();
  await expect(card(THIRD)).toHaveAttribute("tabindex", "0");
  await expect(card(SECOND)).toHaveAttribute("tabindex", "-1");

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

  await press("Enter");
  await expect(screen.getByRole("dialog")).toBeVisible();
  await press("Escape");
  await expect(screen.getByRole("dialog")).toBeHidden();
  await expect(card(THIRD)).toBeFocused();

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

  await card(SECOND).focus();
  await press("f");
  await press("k");
  await expect(card(THIRD)).toBeFocused();
  await press("e");
  await expect(card(THIRD)).toBeHidden({ timeout: 30_000 });
  await expect(card(SECOND)).toBeFocused();

  await press("?");
  await expect(screen.getByRole("dialog", "Keyboard shortcuts")).toBeVisible();
  await press("/");
  await expect(screen.getByRole("dialog", "Keyboard shortcuts")).toBeHidden();
  await expect(search).toBeFocused();
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });

  await press("?");
  const shortcuts = screen.getByRole("dialog", "Keyboard shortcuts");
  await expect(shortcuts).toBeVisible();
  await expect(
    shortcuts.getByRole("region", "Cards").getByText("Move to Trash")
  ).toBeVisible();
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

  await press("n");
  await expect.poll(() => pathOf(browser.url())).toBe("/");
  await expect(
    screen.getByRole("textbox", "Markdown content", { exact: false })
  ).toBeFocused({ timeout: 30_000 });

  // U opens the file picker, as New > Upload files does. (Last:
  // the picker takes focus from the page.) Headless Chromium dismisses the
  // picker at once, which fires `cancel` on the input and makes the app
  // remove it, so the node is gone before any count. Observe that cancel.
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const tracked = window as unknown as { __filePickerCancels: number };
    tracked.__filePickerCancels = 0;
    document.addEventListener(
      "cancel",
      (event) => {
        if (
          event.target instanceof HTMLInputElement &&
          event.target.type === "file"
        ) {
          tracked.__filePickerCancels += 1;
        }
      },
      { capture: true }
    );
    return null;
  });
  await press("u");
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as unknown as { __filePickerCancels: number })
            .__filePickerCancels
      )
    )
    .toBe(1);
});
