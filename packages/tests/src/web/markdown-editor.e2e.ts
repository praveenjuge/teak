import { api } from "@teak/convex";
import { Marked } from "marked";
import {
  blockAndRecordRequests,
  deliverToClient,
  readSocketState,
  routeConvexSocket,
} from "../helpers/page-hooks";
import { describe } from "../helpers/test";
import {
  COMPOSER_EDITOR,
  DIALOG_EDITOR,
  getBlockEditor,
  goToEnd,
  pasteMarkdown,
} from "./editor-library";
import { expect, generateTestContent, test } from "./fixtures";

const RESPONSIVE_KEYSTROKE_TIMEOUT_MS = 30_000;

describe("Markdown editor", { trace: "on", video: "retain-on-failure" }, () => {
  test("creates, saves, and reopens every supported Markdown block", async ({
    app,
    browser,
    screen,
    library,
  }) => {
    const marker = generateTestContent("Editor blocks");
    const markdown = `# ${marker}\n\n## Section\n\n### Detail\n\n**Bold** *italic* ~~strike~~ \`inline\`\n\n[Link](https://example.com)\n\n- Parent\n  - Child\n\n3. Third\n4. Fourth\n\n- [ ] Pending\n- [x] Done\n\n> Quote\n\n\`\`\`ts\nconst value = 1;\n\`\`\`\n\n---`;
    const composer = screen.getByRole("group", "Markdown content editor");
    await pasteMarkdown(browser, COMPOSER_EDITOR, markdown);
    await getBlockEditor(composer);
    await expect(
      composer.getByRole("heading", marker, { exact: false })
    ).toBeVisible();
    await expect(composer.getByRole("checkbox")).toHaveCount(2);
    await screen.getByRole("button", "Save").click();
    await expect(
      screen.getByRole("main").getByText(marker, { exact: false })
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await library.client.query(api.cards.getCards, {})).some(
          (card: { content?: string }) => card.content?.includes(marker)
        )
      )
      .toBe(true);
    const created = (await library.client.query(api.cards.getCards, {})).find(
      (card: { content?: string }) => card.content?.includes(marker)
    );
    if (!created) {
      throw new Error("Created note was not persisted");
    }
    library.ids.push(created._id);
    const renderer = new Marked({ gfm: true });
    expect(renderer.parse(await library.read(created._id))).toBe(
      renderer.parse(markdown)
    );
    await browser.reload();
    const dialog = await library.open(library.ids[0]!);
    await expect(
      dialog.getByRole("heading", marker, { exact: false })
    ).toBeVisible();
    await app.screenshot("supported-blocks");
  });

  test("a URL typed in the composer saves as a link to that exact URL", async ({
    screen,
    library,
  }) => {
    const run = `run=${Date.now()}`;
    const url = `https://example.com/wiki/Tectona_grandis?${run}&lang=en`;
    const composer = screen.getByRole("group", "Markdown content editor");
    await (await getBlockEditor(composer)).fill(url);
    await screen.getByRole("button", "Save").click();
    const findCreated = async () =>
      (await library.client.query(api.cards.getCards, {})).find(
        (card: { content?: string }) => card.content?.includes(run)
      );
    await expect.poll(async () => Boolean(await findCreated())).toBe(true);
    const created = await findCreated();
    if (!created) {
      throw new Error("Created link was not persisted");
    }
    library.ids.push(created._id);
    expect(created).toMatchObject({ type: "link", url, content: url });
  });

  test("a URL pasted in the composer saves as a link", async ({
    browser,
    screen,
    library,
  }) => {
    const run = `run=${Date.now()}`;
    const url = `https://example.com/posts/teak-notes.html?${run}`;
    await pasteMarkdown(browser, COMPOSER_EDITOR, url);
    await screen.getByRole("button", "Save").click();
    const findCreated = async () =>
      (await library.client.query(api.cards.getCards, {})).find(
        (card: { content?: string }) => card.content?.includes(run)
      );
    await expect.poll(async () => Boolean(await findCreated())).toBe(true);
    const created = await findCreated();
    if (!created) {
      throw new Error("Created link was not persisted");
    }
    library.ids.push(created._id);
    expect(created).toMatchObject({ type: "link", url, content: url });
  });

  test("opening and selecting never rewrites an unchanged note", async ({
    browser,
    library,
  }) => {
    const original = `## ${generateTestContent("Exact source")}\r\n\r\n__Bold__  \r\nNext\r\n\r\n* One\r\n* Two\r\n`;
    const id = await library.create(original);
    const stored = await library.read(id);
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await blocks.click();
    await blocks.press("ControlOrMeta+a");
    await expect(dialog.getByText("Unsaved changes")).toHaveCount(0);
    await browser.keyboard.press("Escape");
    expect(await library.read(id)).toBe(stored);
  });

  test("edits existing Markdown and preserves untouched nested content", async ({
    browser,
    library,
  }) => {
    const original = `# ${generateTestContent("Existing")}\n\n- Parent\n  - Child\n\n\`\`\`ts\nconst code = '<script>';\n\`\`\`\n\nLast`;
    const id = await library.create(original);
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await goToEnd(browser, DIALOG_EDITOR);
    await blocks.pressSequentially(" edited");
    await blocks.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toBe(`${original} edited`);
  });

  test("unsupported Markdown stays editable as literal text without a mode switch", async ({
    browser,
    library,
  }) => {
    const source = `---\ntitle: ${generateTestContent("Source")}\n---\n\n![Private](https://private.example/image.png)\n\n[label][ref]\n\n[ref]: https://example.com`;
    const requests = await blockAndRecordRequests(browser, /private\.example/);
    const id = await library.create(source);
    const dialog = await library.open(id);
    const input = await getBlockEditor(dialog);
    await expect(input).toHaveText(source);
    await expect(
      browser.locator(
        '[role="dialog"] main textarea, [role="dialog"] img, [role="dialog"] script'
      )
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", /Markdown source|block editor/)
    ).toHaveCount(0);
    await goToEnd(browser, DIALOG_EDITOR);
    await input.press("Enter");
    await input.press("Enter");
    await input.pressSequentially("Edited");
    await input.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toBe(`${source}\n\nEdited`);
    expect(requests).toEqual([]);
  });

  test("literal notes preserve pasted URLs, HTML, and line breaks", async ({
    browser,
    library,
  }) => {
    const id = await library.create("---\ntitle: Literal note\n---\n\nBody");
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await blocks.press("ControlOrMeta+a");
    await pasteMarkdown(browser, DIALOG_EDITOR, "https://example.com");
    await expect(blocks).toHaveText("https://example.com");
    await expect(blocks.getByRole("link")).toHaveCount(0);
    await goToEnd(browser, DIALOG_EDITOR);
    await blocks.press("Enter");
    const html =
      '<img src="https://private.example/image.png" onerror="alert(1)">';
    await pasteMarkdown(browser, DIALOG_EDITOR, html);
    await expect(
      browser.locator(`${DIALOG_EDITOR} img, ${DIALOG_EDITOR} script`)
    ).toHaveCount(0);
    await blocks.press("ControlOrMeta+Enter");
    await expect
      .poll(() => library.read(id))
      .toBe(`https://example.com\n${html}`);
  });

  test("fullscreen transitions preserve drafts without saving", async ({
    browser,
    screen,
    library,
  }) => {
    const marker = generateTestContent("Fullscreen draft");
    const composer = screen.getByRole("group", "Markdown content editor");
    const before = await library.client.query(api.cards.getCards, {});
    const blocks = await getBlockEditor(composer);
    await blocks.fill(marker);
    await blocks.press("ControlOrMeta+e");
    const dialog = screen.getByRole("dialog");
    const fullscreen = await getBlockEditor(dialog);
    await goToEnd(browser, DIALOG_EDITOR);
    await fullscreen.pressSequentially(" continued");
    await dialog.getByRole("button", "Close").click();
    await expect(await getBlockEditor(composer)).toHaveText(
      `${marker} continued`
    );
    const after = await library.client.query(api.cards.getCards, {});
    expect(after.length).toBe(before.length);
  });

  test("closing a card preserves the existing save-on-close behavior", async ({
    browser,
    library,
  }) => {
    const original = generateTestContent("Cancel");
    const id = await library.create(original);
    const dialog = await library.open(id);
    await (await getBlockEditor(dialog)).fill(`${original} edited`);
    await browser.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => library.read(id)).toBe(`${original} edited`);
    await expect(
      (await library.open(id)).getByRole("textbox", "Markdown content", {
        exact: false,
      })
    ).toHaveText(`${original} edited`);
  });

  test("slash commands work by keyboard inside a dialog", async ({
    browser,
    screen,
    library,
  }) => {
    const id = await library.create(generateTestContent("Slash"));
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await goToEnd(browser, DIALOG_EDITOR);
    await blocks.press("Enter");
    await blocks.pressSequentially("/zzzzz");
    await expect(screen.getByRole("listbox")).toHaveCount(0);
    await expect(blocks).not.toHaveAttribute("aria-controls", /.+/);
    await expect(blocks).not.toHaveAttribute("aria-activedescendant", /.+/);
    for (const _character of "zzzzz") {
      await blocks.press("Backspace");
    }
    await blocks.pressSequentially("heading");
    await screen.getByRole("option", /Heading 2/).waitFor({ state: "visible" });
    await blocks.press("ArrowDown");
    await blocks.press("Enter");
    await blocks.pressSequentially("Keyboard heading");
    await expect(
      dialog.getByRole("heading", {
        name: "Keyboard heading",
        level: 2,
        exact: false,
      })
    ).toBeVisible();
    await blocks.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toContain("## Keyboard heading");
  });

  test("typing supports undo and redo without block movement controls", async ({
    browser,
    library,
  }) => {
    const marker = generateTestContent("Undo");
    const id = await library.create(`${marker}\n\nFirst\n\nSecond`);
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await goToEnd(browser, DIALOG_EDITOR);
    await blocks.pressSequentially(" edited");
    // e2e reads rendered text (innerText), so the three paragraphs read with
    // a separator.
    await expect(blocks).toHaveText(`${marker} First Second edited`);
    await blocks.press("ControlOrMeta+z");
    await expect(blocks).toHaveText(`${marker} First Second`);
    await blocks.press("ControlOrMeta+Shift+z");
    await expect(blocks).toHaveText(`${marker} First Second edited`);
    await expect(dialog.getByLabel("Drag block", { exact: false })).toHaveCount(
      0
    );
    await blocks.press("ControlOrMeta+Enter");
    await expect
      .poll(() => library.read(id))
      .toBe(`${marker}\n\nFirst\n\nSecond edited`);
  });

  test("task toggles persist as Markdown", async ({ library }) => {
    const id = await library.create("# Tasks\n\n- [ ] Pending");
    const dialog = await library.open(id);
    await dialog.getByRole("checkbox").check();
    await expect(dialog.getByText("Saved")).toBeVisible();
    await expect.poll(() => library.read(id)).toContain("- [x] Pending");
  });

  test("a ticked item moves below the open ones, and undo puts it back", async ({
    browser,
    library,
  }) => {
    const before =
      "# Chores\n\n- [ ] Water plants\n- [ ] Buy milk\n- [ ] Call home";
    const after =
      "# Chores\n\n- [ ] Buy milk\n- [ ] Call home\n- [x] Water plants";
    const id = await library.create(before);
    const dialog = await library.open(id);
    const firstItem = () => dialog.getByRole("checkbox").first();
    await dialog
      .getByRole("checkbox", "Water plants", { exact: false })
      .check();
    await expect(firstItem()).toHaveAttribute(
      "aria-label",
      "Task item checkbox for Buy milk"
    );
    await expect.poll(() => library.read(id)).toBe(after);

    await browser.keyboard.press("ControlOrMeta+z");
    await expect(firstItem()).toHaveAttribute(
      "aria-label",
      "Task item checkbox for Water plants"
    );
    await expect(firstItem()).not.toBeChecked();
    await expect.poll(() => library.read(id)).toBe(before);

    await dialog
      .getByRole("checkbox", "Water plants", { exact: false })
      .check();
    await expect.poll(() => library.read(id)).toBe(after);
    await browser.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const reopened = await library.open(id);
    await expect(reopened.getByRole("checkbox").first()).toHaveAttribute(
      "aria-label",
      "Task item checkbox for Buy milk"
    );
  });

  test("rejects oversized ASCII and Unicode edits without losing the draft", async ({
    screen,
    webAccount: _signedIn,
  }) => {
    const composer = screen.getByRole("group", "Markdown content editor");
    const input = await getBlockEditor(composer);
    for (const valid of ["a".repeat(512 * 1024), "é".repeat(256 * 1024)]) {
      await input.fill(valid);
      await expect(input).toHaveText(valid);
      await input.press("End");
      await input.pressSequentially("x", {
        timeout: RESPONSIVE_KEYSTROKE_TIMEOUT_MS,
      });
      await expect(input).toHaveText(valid);
      await expect(
        screen
          .getByText("Notes can be up to 512 KiB of UTF-8 text", {
            exact: false,
          })
          .first()
      ).toBeVisible();
    }
  });

  test("accepts typing up to exactly the UTF-8 limit", async ({
    screen,
    webAccount: _signedIn,
  }) => {
    const composer = screen.getByRole("group", "Markdown content editor");
    const input = await getBlockEditor(composer);
    const draft = `${"é".repeat(256 * 1024 - 1)}a`;
    await input.fill(draft);
    await expect(input).toHaveText(draft);
    await input.press("End");
    await input.pressSequentially("x");
    await expect(input).toHaveText(`${draft}x`);
  });

  test("pasted HTML and unsafe links remain inert", async ({
    browser,
    library,
  }) => {
    const id = await library.create(generateTestContent("Safe paste"));
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    const requests = await blockAndRecordRequests(browser, /private\.example/);
    const unsafe =
      '<img src="https://private.example/image.png" onerror="window.__editorInjected=true">[link](javascript:alert(1))';
    await pasteMarkdown(browser, DIALOG_EDITOR, unsafe, unsafe);
    await expect(blocks).toContainText(unsafe);
    await expect(
      browser.locator(
        `${DIALOG_EDITOR} img, ${DIALOG_EDITOR} script, ${DIALOG_EDITOR} a[href^='javascript:']`
      )
    ).toHaveCount(0);
    expect(await browser.evaluate(() => "__editorInjected" in window)).toBe(
      false
    );
    expect(requests).toEqual([]);
  });

  test("formatting controls work in dark mode at a narrow width", async ({
    app,
    browser,
    screen,
    library,
  }) => {
    await browser.setViewport({ width: 390, height: 844 });
    const id = await library.create(generateTestContent("Formatting"));
    const dialog = await library.open(id);
    await browser.evaluate(() => {
      document.documentElement.classList.add("dark");
      return null;
    });
    const blocks = await getBlockEditor(dialog);
    await blocks.press("ControlOrMeta+a");
    await screen.getByRole("button", "Bold").click();
    await expect(browser.locator(`${DIALOG_EDITOR} strong`)).toBeVisible();
    await blocks.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toMatch(/^\*\*.*\*\*$/);
    expect(
      await browser.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await app.screenshot("narrow-dark-editor");
  });

  test("a failed save keeps the draft and can be retried", async ({
    browser,
    library,
  }) => {
    const original = generateTestContent("Retry");
    const id = await library.create(original);
    await routeConvexSocket(browser, {
      fromClient: (message, context) => {
        if (
          !context.state.failed &&
          message.type === "Mutation" &&
          message.udfPath === "cards:updateCardField"
        ) {
          context.state.failed = true;
          context.toClient({
            type: "MutationResponse",
            requestId: message.requestId,
            success: false,
            result: "Editor test save failure",
            logLines: [],
          });
          return null;
        }
        return message;
      },
    });
    await browser.reload();
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await blocks.fill(`${original} edited`);
    await expect
      .poll(async () => (await readSocketState(browser)).failed)
      .toBe(true);
    await expect(dialog.getByText("Couldn't save")).toBeVisible();
    expect(await library.read(id)).toBe(original);
    await expect(blocks).toHaveText(`${original} edited`);
    await blocks.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toBe(`${original} edited`);
  });

  test("compact slash controls change the draft without submitting it", async ({
    browser,
    screen,
    library,
  }) => {
    const before = await library.client.query(api.cards.getCards, {});
    const composer = screen.getByRole("group", "Markdown content editor");
    await pasteMarkdown(browser, COMPOSER_EDITOR, "First\n\nSecond");
    const blocks = await getBlockEditor(composer);
    await goToEnd(browser, COMPOSER_EDITOR);
    await blocks.press("Enter");
    await blocks.pressSequentially("/heading");
    await composer.getByRole("option", "Heading 2").click();
    await blocks.pressSequentially("Draft heading");
    await expect(browser.locator(`${COMPOSER_EDITOR} h2`)).toHaveText(
      "Draft heading"
    );
    await expect(
      composer.getByRole("button", "Move block up", { exact: false })
    ).toHaveCount(0);
    await expect(screen.getByRole("button", "Save")).toBeEnabled();
    expect((await library.client.query(api.cards.getCards, {})).length).toBe(
      before.length
    );
  });

  test("keyboard link editing validates URLs and preserves modal focus", async ({
    library,
  }) => {
    const id = await library.create("Link text");
    const dialog = await library.open(id);
    const blocks = await getBlockEditor(dialog);
    await blocks.press("ControlOrMeta+a");
    await blocks.press("ControlOrMeta+k");
    const input = dialog.getByRole("textbox", "Link URL", { exact: false });
    await expect(input).toBeFocused();
    await input.fill("javascript:alert(1)");
    await input.press("Enter");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("https://example.com");
    await input.press("Enter");
    await expect(
      blocks.getByRole("link", "Link text", { exact: false })
    ).toHaveAttribute("href", "https://example.com");
    await blocks.press("ControlOrMeta+Enter");
    await expect
      .poll(() => library.read(id))
      .toBe("[Link text](https://example.com)");
  });

  test("aligned tables remain editable as literal Markdown without table controls", async ({
    browser,
    library,
  }) => {
    const original = "| Name | State |\n| :--- | ---: |\n| Alpha | Ready |";
    const id = await library.create(original);
    const dialog = await library.open(id);
    const editor = await getBlockEditor(dialog);
    await expect(editor).toHaveText(original);
    await expect(dialog.getByRole("table")).toHaveCount(0);
    await expect(dialog.getByRole("button", "Add row")).toHaveCount(0);
    await goToEnd(browser, DIALOG_EDITOR);
    await editor.pressSequentially(" edited");
    await expect(editor).toHaveText(`${original} edited`);
    await editor.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toBe(`${original} edited`);
    await expect(await getBlockEditor(await library.open(id))).toHaveText(
      `${original} edited`
    );
  });

  test("trailing blank lines reach the saved draft", async ({
    browser,
    library,
  }) => {
    const original = generateTestContent("Blank line");
    const id = await library.create(original);
    const dialog = await library.open(id);
    const editor = await getBlockEditor(dialog);
    await goToEnd(browser, DIALOG_EDITOR);
    await editor.press("Enter");
    await editor.press("ControlOrMeta+Enter");
    await expect.poll(() => library.read(id)).toBe(`${original}\n\n`);
  });

  test("a disabled composer restores its draft after a failed save", async ({
    browser,
    screen,
    library,
  }) => {
    const marker = generateTestContent("Disabled restore");
    await routeConvexSocket(browser, {
      fromClient: (message, context) => {
        for (const query of message.modifications ?? []) {
          if (query.udfPath === "auth:getCardCreationStatus") {
            context.state.statusQuery = query.queryId;
          }
        }
        if (
          message.type === "Mutation" &&
          message.udfPath === "cards:createCard"
        ) {
          context.state.requestId = message.requestId;
        }
        return message;
      },
      fromServer: (message, context) => {
        const state = context.state;
        if (
          message.type === "MutationResponse" &&
          message.requestId === state.requestId
        ) {
          state.heldResponse = true;
          return null;
        }
        if (message.type === "Transition") {
          for (const modification of message.modifications ?? []) {
            if (
              modification.type === "QueryUpdated" &&
              modification.queryId === state.statusQuery
            ) {
              state.lastStatus = modification;
            }
          }
          if (state.requestId !== undefined && state.lastStatus) {
            message.modifications = message.modifications.filter(
              (modification: { queryId?: number }) =>
                modification.queryId !== state.statusQuery
            );
            message.modifications.push({
              ...state.lastStatus,
              value: { canCreateCard: false, hasPremium: false },
            });
          }
        }
        return message;
      },
    });
    await browser.reload();
    const composer = screen.getByRole("group", "Markdown content editor");
    const editor = await getBlockEditor(composer);
    await editor.fill(marker);
    await expect
      .poll(async () => (await readSocketState(browser)).statusQuery, {
        message: "Capture card creation status query",
      })
      .toBeDefined();
    await screen.getByRole("button", "Save").click();
    await expect
      .poll(async () => (await readSocketState(browser)).requestId, {
        message: "Capture card creation mutation",
      })
      .toBeDefined();
    await expect(editor).toHaveAttribute("aria-readonly", "true");
    await expect
      .poll(async () => (await readSocketState(browser)).heldResponse)
      .toBe(true);
    const { requestId } = await readSocketState<{ requestId: number }>(browser);
    await deliverToClient(browser, {
      type: "MutationResponse",
      requestId,
      success: false,
      result: "Editor test card limit",
      logLines: [],
    });
    await expect(editor).toHaveText(marker);
    const saved = (await library.client.query(api.cards.getCards, {})).find(
      (card: { content?: string }) => card.content === marker
    );
    if (!saved) {
      throw new Error("Missing owned test card");
    }
    library.ids.push(saved._id);
    await pasteMarkdown(browser, COMPOSER_EDITOR, "Rejected while disabled");
    await expect(editor).toHaveText(marker);
  });

  test("link editing keeps the original selection when the selection changes", async ({
    browser,
    library,
  }) => {
    const original = "First\n\nMiddle\n\nAnother passage\n\nSecond";
    const id = await library.create(original);
    const dialog = await library.open(id);
    const editor = await getBlockEditor(dialog);
    const selectParagraph = (which: "first" | "last") =>
      browser.evaluate(
        ([selector, position]) => {
          const paragraphs = document.querySelectorAll(selector);
          const element =
            paragraphs[position === "first" ? 0 : paragraphs.length - 1];
          if (!element) {
            throw new Error(`No element for ${selector}`);
          }
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (position === "last") {
            (
              element.closest('[contenteditable="true"]') as HTMLElement
            ).focus();
          }
          return null;
        },
        [`${DIALOG_EDITOR} p`, which] as [string, string]
      );
    await selectParagraph("first");
    await editor.press("ControlOrMeta+k");
    const input = dialog.getByRole("textbox", "Link URL", { exact: false });
    await input.fill("https://example.com");
    await selectParagraph("last");
    await dialog.getByRole("button", "Apply").click();
    await expect(editor.getByRole("link", "First")).toHaveAttribute(
      "href",
      "https://example.com"
    );
    await expect(editor.getByRole("link", "Second")).toHaveCount(0);
    await editor.press("ControlOrMeta+Enter");
    await expect
      .poll(() => library.read(id))
      .toBe(original.replace("First", "[First](https://example.com)"));
  });
});
