import { Marked } from "marked";
import { describe } from "../helpers/test";
import {
  COMPOSER_EDITOR,
  DIALOG_EDITOR,
  getBlockEditor,
  goToEnd,
  pasteMarkdown,
} from "./editor-library";
import { expect, generateTestContent, test } from "./fixtures";

const lexer = new Marked({ gfm: true });

/** The header and body cell text of the first table in `markdown`. */
const tableCells = (markdown: string) => {
  const table = lexer.lexer(markdown).find((token) => token.type === "table") as
    | {
        header: { text: string }[];
        rows: { text: string }[][];
      }
    | undefined;
  return table
    ? [
        table.header.map((cell) => cell.text),
        ...table.rows.map((row) => row.map((cell) => cell.text)),
      ]
    : null;
};

describe("Tables in notes", { trace: "on", video: "retain-on-failure" }, () => {
  test("/table makes a table you fill with Tab, grow and trim from ⋯, and it reopens", async ({
    browser,
    screen,
    library,
  }) => {
    const marker = generateTestContent("Tables");
    const id = await library.create(marker);
    const dialog = await library.open(id);
    const editor = await getBlockEditor(dialog);
    await goToEnd(browser, DIALOG_EDITOR);
    await editor.press("Enter");
    await editor.pressSequentially("/table");
    await expect(
      screen
        .getByRole("listbox", "Formatting commands")
        .getByRole("option", "Table", {
          exact: false,
        })
    ).toBeVisible();
    await editor.press("Enter");
    const table = dialog.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await expect(table.getByRole("row")).toHaveCount(3);

    for (const [index, text] of [
      "Plan",
      "Price",
      "Seats",
      "Free",
      "$0",
      "1",
      "Pro",
      "$8",
      "5",
    ].entries()) {
      if (index > 0) {
        await editor.press("Tab");
      }
      await editor.pressSequentially(text);
    }
    await editor.press("Tab");
    await expect(table.getByRole("row")).toHaveCount(4);
    await editor.pressSequentially("Team");

    await screen.getByRole("button", "Table options").click();
    await screen.getByRole("menuitem", "Add column right").click();
    await expect(table.getByRole("columnheader")).toHaveCount(4);
    // Into the new, empty column beside "Team", then delete it.
    await editor.press("Tab");
    await screen.getByRole("button", "Table options").click();
    await screen.getByRole("menuitem", "Delete column").click();
    await expect(table.getByRole("columnheader")).toHaveCount(3);

    // Keyboard only: Alt+F10 reaches the ⋯ button, Esc returns to the cell.
    await editor.press("Alt+F10");
    await expect(screen.getByRole("button", "Table options")).toBeFocused();
    await browser.keyboard.press("Enter");
    await expect(screen.getByRole("menuitem", "Delete table")).toBeVisible();
    await browser.keyboard.press("Escape");
    await expect(editor).toBeFocused();

    await editor.press("ControlOrMeta+Enter");
    const expected = [
      ["Plan", "Price", "Seats"],
      ["Free", "$0", "1"],
      ["Pro", "$8", "5"],
      ["Team", "", ""],
    ];
    await expect
      .poll(async () => tableCells(await library.read(id)))
      .toEqual(expected);
    expect((await library.read(id)).startsWith(`${marker}\n\n|`)).toBe(true);

    const reopened = await library.open(id);
    await expect(reopened.getByRole("table")).toBeVisible();
    await expect(
      reopened.getByRole("cell", "Team", { exact: true })
    ).toBeVisible();
  });

  test("a pasted GFM table becomes a table, and its tile reads as text", async ({
    browser,
    screen,
    library,
  }) => {
    const marker = generateTestContent("Pasted table");
    const markdown = `${marker}\n\n| Name | State |\n| --- | --- |\n| Alpha | Ready |`;
    const id = await library.create(markdown);
    const dialog = await library.open(id);
    await expect(dialog.getByRole("table")).toBeVisible();
    expect(await library.read(id)).toBe(markdown);
    await browser.keyboard.press("Escape");
    await expect(
      screen
        .getByRole("main")
        .getByText("Name · State / Alpha · Ready", { exact: false })
    ).toBeVisible();

    const composer = screen.getByRole("group", "Markdown content editor");
    await pasteMarkdown(
      browser,
      COMPOSER_EDITOR,
      "| One | Two |\n| --- | --- |\n| 1 | 2 |"
    );
    await expect(composer.getByRole("table")).toBeVisible();
  });
});
