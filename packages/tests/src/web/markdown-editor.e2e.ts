import { api } from "@teak/convex";
import { Marked } from "marked";
import { getBlockEditor, goToEnd, pasteMarkdown } from "./editor-library";
import { convexSocket, expect, generateTestContent, test } from "./fixtures";

test.use({ trace: "on", video: "retain-on-failure" });

test("creates, saves, and reopens every supported Markdown block", async ({
  page,
  library,
}, testInfo) => {
  const marker = generateTestContent("Editor blocks");
  const markdown = `# ${marker}\n\n## Section\n\n### Detail\n\n**Bold** *italic* ~~strike~~ \`inline\`\n\n[Link](https://example.com)\n\n- Parent\n  - Child\n\n3. Third\n4. Fourth\n\n- [ ] Pending\n- [x] Done\n\n> Quote\n\n\`\`\`ts\nconst value = 1;\n\`\`\`\n\n---`;
  const composer = page.getByRole("group", { name: "Markdown content editor" });
  await pasteMarkdown(composer, markdown);
  await getBlockEditor(composer);
  await expect(composer.getByRole("heading", { name: marker })).toBeVisible();
  await expect(composer.getByRole("checkbox")).toHaveCount(2);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("main").getByText(marker, { exact: false })
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
  await page.reload();
  const dialog = await library.open(library.ids[0]!);
  await expect(dialog.getByRole("heading", { name: marker })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("supported-blocks.png") });
  await testInfo.attach("Stored Markdown", {
    body: await library.read(library.ids[0]!),
    contentType: "text/markdown",
  });
});

test("opening and selecting never rewrites an unchanged note", async ({
  page,
  library,
}) => {
  const original = `## ${generateTestContent("Exact source")}\r\n\r\n__Bold__  \r\nNext\r\n\r\n* One\r\n* Two\r\n`;
  const id = await library.create(original);
  const stored = await library.read(id);
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  await blocks.click();
  await blocks.press("ControlOrMeta+a");
  await expect(
    dialog.getByRole("button", { name: "Save changes" })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await library.read(id)).toBe(stored);
});

test("edits existing Markdown and preserves untouched nested content", async ({
  library,
}) => {
  const original = `# ${generateTestContent("Existing")}\n\n- Parent\n  - Child\n\n\`\`\`ts\nconst code = '<script>';\n\`\`\`\n\nLast`;
  const id = await library.create(original);
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  await goToEnd(blocks);
  await blocks.pressSequentially(" edited");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => library.read(id)).toBe(`${original} edited`);
});

test("unsupported Markdown stays editable as literal text without a mode switch", async ({
  page,
  library,
}) => {
  const source = `---\ntitle: ${generateTestContent("Source")}\n---\n\n![Private](https://private.example/image.png)\n\n[label][ref]\n\n[ref]: https://example.com`;
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("private.example")) {
      requests.push(request.url());
    }
  });
  const id = await library.create(source);
  const dialog = await library.open(id);
  const input = await getBlockEditor(dialog);
  await expect(input).toHaveText(source);
  await expect(dialog.locator("textarea, img, script")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: /Markdown source|block editor/ })
  ).toHaveCount(0);
  await goToEnd(input);
  await input.press("Enter");
  await input.press("Enter");
  await input.pressSequentially("Edited");
  await input.press("ControlOrMeta+Enter");
  await expect.poll(() => library.read(id)).toBe(`${source}\n\nEdited`);
  expect(requests).toEqual([]);
});

test("literal notes preserve pasted URLs, HTML, and line breaks", async ({
  library,
}) => {
  const id = await library.create("---\ntitle: Literal note\n---\n\nBody");
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  await blocks.press("ControlOrMeta+a");
  await pasteMarkdown(dialog, "https://example.com");
  await expect(blocks).toHaveText("https://example.com");
  await expect(blocks.getByRole("link")).toHaveCount(0);
  await goToEnd(blocks);
  await blocks.press("Enter");
  const html =
    '<img src="https://private.example/image.png" onerror="alert(1)">';
  await pasteMarkdown(dialog, html);
  await expect(blocks.locator("img, script")).toHaveCount(0);
  await blocks.press("ControlOrMeta+Enter");
  await expect
    .poll(() => library.read(id))
    .toBe(`https://example.com\n${html}`);
});

test("fullscreen transitions preserve drafts without saving", async ({
  page,
  library,
}) => {
  const marker = generateTestContent("Fullscreen draft");
  const composer = page.getByRole("group", { name: "Markdown content editor" });
  const before = await library.client.query(api.cards.getCards, {});
  const blocks = await getBlockEditor(composer);
  await blocks.fill(marker);
  await blocks.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog");
  const fullscreen = await getBlockEditor(dialog);
  await goToEnd(fullscreen);
  await fullscreen.pressSequentially(" continued");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(await getBlockEditor(composer)).toHaveText(
    `${marker} continued`
  );
  const after = await library.client.query(api.cards.getCards, {});
  expect(after.length).toBe(before.length);
});

test("closing a card preserves the existing save-on-close behavior", async ({
  page,
  library,
}) => {
  const original = generateTestContent("Cancel");
  const id = await library.create(original);
  const dialog = await library.open(id);
  await (await getBlockEditor(dialog)).fill(`${original} edited`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => library.read(id)).toBe(`${original} edited`);
  await expect(
    (await library.open(id)).getByRole("textbox", { name: "Markdown content" })
  ).toHaveText(`${original} edited`);
});

test("slash commands work by keyboard inside a dialog", async ({ library }) => {
  const id = await library.create(generateTestContent("Slash"));
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  await goToEnd(blocks);
  await blocks.press("Enter");
  await blocks.pressSequentially("/zzzzz");
  await expect(dialog.page().getByRole("listbox")).toHaveCount(0);
  await expect(blocks).not.toHaveAttribute("aria-controls", /.+/);
  await expect(blocks).not.toHaveAttribute("aria-activedescendant", /.+/);
  for (const _character of "zzzzz") {
    await blocks.press("Backspace");
  }
  await blocks.pressSequentially("heading");
  await dialog
    .page()
    .getByRole("option", { name: /Heading 2/ })
    .waitFor({ state: "visible" });
  await blocks.press("ArrowDown");
  await blocks.press("Enter");
  await blocks.pressSequentially("Keyboard heading");
  await expect(
    dialog.getByRole("heading", { name: "Keyboard heading", level: 2 })
  ).toBeVisible();
  await blocks.press("ControlOrMeta+Enter");
  await expect.poll(() => library.read(id)).toContain("## Keyboard heading");
});

test("typing supports undo and redo without block movement controls", async ({
  library,
}) => {
  const marker = generateTestContent("Undo");
  const id = await library.create(`${marker}\n\nFirst\n\nSecond`);
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  await goToEnd(blocks);
  await blocks.pressSequentially(" edited");
  await expect(blocks).toHaveText(`${marker}FirstSecond edited`);
  await blocks.press("ControlOrMeta+z");
  await expect(blocks).toHaveText(`${marker}FirstSecond`);
  await blocks.press("ControlOrMeta+Shift+z");
  await expect(blocks).toHaveText(`${marker}FirstSecond edited`);
  await expect(dialog.getByLabel("Drag block")).toHaveCount(0);
  await blocks.press("ControlOrMeta+Enter");
  await expect
    .poll(() => library.read(id))
    .toBe(`${marker}\n\nFirst\n\nSecond edited`);
});

test("task toggles persist as Markdown", async ({ library }) => {
  const id = await library.create("# Tasks\n\n- [ ] Pending");
  const dialog = await library.open(id);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => library.read(id)).toContain("- [x] Pending");
});

test("rejects oversized ASCII and Unicode edits without losing the draft", async ({
  page,
}) => {
  const composer = page.getByRole("group", { name: "Markdown content editor" });
  const input = await getBlockEditor(composer);
  for (const valid of ["a".repeat(512 * 1024), "é".repeat(256 * 1024)]) {
    await input.fill(valid);
    await expect(input).toHaveText(valid);
    await input.press("End");
    await input.pressSequentially("x");
    await expect(input).toHaveText(valid);
    await expect(
      page.getByText("Notes can be up to 512 KiB of UTF-8 text").first()
    ).toBeVisible();
  }
});

test("pasted HTML and unsafe links remain inert", async ({ page, library }) => {
  const id = await library.create(generateTestContent("Safe paste"));
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("private.example")) {
      requests.push(request.url());
    }
  });
  const unsafe =
    '<img src="https://private.example/image.png" onerror="window.__editorInjected=true">[link](javascript:alert(1))';
  await blocks.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    data.setData("text/html", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
    );
  }, unsafe);
  await expect(blocks).toContainText(unsafe);
  await expect(
    blocks.locator("img, script, a[href^='javascript:']")
  ).toHaveCount(0);
  expect(await page.evaluate(() => "__editorInjected" in window)).toBe(false);
  expect(requests).toEqual([]);
});

test("formatting controls work in dark mode at a narrow width", async ({
  page,
  library,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await library.create(generateTestContent("Formatting"));
  const dialog = await library.open(id);
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  const blocks = await getBlockEditor(dialog);
  await blocks.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(blocks.locator("strong")).toBeVisible();
  await blocks.press("ControlOrMeta+Enter");
  await expect.poll(() => library.read(id)).toMatch(/^\*\*.*\*\*$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("narrow-dark-editor.png"),
  });
});

test("a failed save keeps the draft and can be retried", async ({
  page,
  library,
}) => {
  const original = generateTestContent("Retry");
  const id = await library.create(original);
  await page.reload();
  // Inject one server failure at the network boundary; the retry reaches Convex.
  let failed = false;
  await page.routeWebSocket(convexSocket, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const data = JSON.parse(message.toString());
      if (
        !failed &&
        data.type === "Mutation" &&
        data.udfPath === "cards:updateCardField"
      ) {
        failed = true;
        socket.send(
          JSON.stringify({
            type: "MutationResponse",
            requestId: data.requestId,
            success: false,
            result: "Editor test save failure",
            logLines: [],
          })
        );
      } else {
        server.send(message);
      }
    });
  });
  await page.reload();
  const dialog = await library.open(id);
  const blocks = await getBlockEditor(dialog);
  await blocks.fill(`${original} edited`);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => failed).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Save changes" })
  ).toBeVisible();
  expect(await library.read(id)).toBe(original);
  await expect(blocks).toHaveText(`${original} edited`);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => library.read(id)).toBe(`${original} edited`);
});

test("compact slash controls change the draft without submitting it", async ({
  page,
  library,
}) => {
  const before = await library.client.query(api.cards.getCards, {});
  const composer = page.getByRole("group", { name: "Markdown content editor" });
  await pasteMarkdown(composer, "First\n\nSecond");
  const blocks = await getBlockEditor(composer);
  await goToEnd(blocks);
  await blocks.press("Enter");
  await blocks.pressSequentially("/heading");
  await composer
    .getByRole("option", { name: "Heading 2", exact: true })
    .click();
  await blocks.pressSequentially("Draft heading");
  await expect(blocks.locator("h2")).toHaveText("Draft heading");
  await expect(
    composer.getByRole("button", { name: "Move block up" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save", exact: true })
  ).toBeEnabled();
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
  const input = dialog.getByRole("textbox", { name: "Link URL" });
  await expect(input).toBeFocused();
  await input.fill("javascript:alert(1)");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("https://example.com");
  await input.press("Enter");
  await expect(blocks.getByRole("link", { name: "Link text" })).toHaveAttribute(
    "href",
    "https://example.com"
  );
  await blocks.press("ControlOrMeta+Enter");
  await expect
    .poll(() => library.read(id))
    .toBe("[Link text](https://example.com)");
});

test("existing tables remain editable as literal Markdown without table controls", async ({
  library,
}) => {
  const original = "| Name | State |\n| --- | --- |\n| Alpha | Ready |";
  const id = await library.create(original);
  const dialog = await library.open(id);
  const editor = await getBlockEditor(dialog);
  await expect(editor).toHaveText(original);
  await expect(dialog.getByRole("table")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Add row", exact: true })
  ).toHaveCount(0);
  await goToEnd(editor);
  await editor.pressSequentially(" edited");
  await expect(editor).toHaveText(`${original} edited`);
  await editor.press("ControlOrMeta+Enter");
  await expect.poll(() => library.read(id)).toBe(`${original} edited`);
  await expect(await getBlockEditor(await library.open(id))).toHaveText(
    `${original} edited`
  );
});

test("trailing blank lines reach the saved draft", async ({ library }) => {
  const original = generateTestContent("Blank line");
  const id = await library.create(original);
  const dialog = await library.open(id);
  const editor = await getBlockEditor(dialog);
  await goToEnd(editor);
  await editor.press("Enter");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => library.read(id)).toBe(`${original}\n\n`);
});

test("a disabled composer restores its draft after a failed save", async ({
  page,
  library,
}) => {
  const marker = generateTestContent("Disabled restore");
  let statusQuery: number | undefined;
  let lastStatus: Record<string, unknown> | undefined;
  let requestId: number | undefined;
  let pendingFailure: (() => void) | undefined;
  await page.routeWebSocket(convexSocket, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const data = JSON.parse(message.toString());
      for (const query of data.modifications ?? []) {
        if (query.udfPath === "auth:getCardCreationStatus") {
          statusQuery = query.queryId;
        }
      }
      if (data.type === "Mutation" && data.udfPath === "cards:createCard") {
        requestId = data.requestId;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const data = JSON.parse(message.toString());
      if (data.type === "MutationResponse" && data.requestId === requestId) {
        pendingFailure = () =>
          socket.send(
            JSON.stringify({
              type: "MutationResponse",
              requestId,
              success: false,
              result: "Editor test card limit",
              logLines: [],
            })
          );
        return;
      }
      if (data.type === "Transition") {
        for (const modification of data.modifications ?? []) {
          if (
            modification.type === "QueryUpdated" &&
            modification.queryId === statusQuery
          ) {
            lastStatus = modification;
          }
        }
        if (requestId !== undefined && lastStatus) {
          data.modifications = data.modifications.filter(
            (modification: { queryId?: number }) =>
              modification.queryId !== statusQuery
          );
          data.modifications.push({
            ...lastStatus,
            value: { canCreateCard: false, hasPremium: false },
          });
        }
      }
      socket.send(JSON.stringify(data));
    });
  });
  await page.reload();
  const composer = page.getByRole("group", { name: "Markdown content editor" });
  const editor = await getBlockEditor(composer);
  await editor.fill(marker);
  await expect
    .poll(() => statusQuery, { message: "Capture card creation status query" })
    .toBeDefined();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => requestId, { message: "Capture card creation mutation" })
    .toBeDefined();
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await expect.poll(() => Boolean(pendingFailure)).toBe(true);
  pendingFailure?.();
  await expect(editor).toHaveText(marker);
  const saved = (await library.client.query(api.cards.getCards, {})).find(
    (card: { content?: string }) => card.content === marker
  );
  if (!saved) {
    throw new Error("Missing owned test card");
  }
  library.ids.push(saved._id);
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Rejected while disabled");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
    );
  });
  await expect(editor).toHaveText(marker);
});

test("link editing keeps the original selection when the selection changes", async ({
  library,
}) => {
  const original = "First\n\nMiddle\n\nAnother passage\n\nSecond";
  const id = await library.create(original);
  const dialog = await library.open(id);
  const editor = await getBlockEditor(dialog);
  await editor
    .locator("p")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  await editor.press("ControlOrMeta+k");
  const input = dialog.getByRole("textbox", { name: "Link URL" });
  await input.fill("https://example.com");
  await editor
    .locator("p")
    .last()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (element.closest('[contenteditable="true"]') as HTMLElement).focus();
    });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    editor.getByRole("link", { name: "First", exact: true })
  ).toHaveAttribute("href", "https://example.com");
  await expect(
    editor.getByRole("link", { name: "Second", exact: true })
  ).toHaveCount(0);
  await editor.press("ControlOrMeta+Enter");
  await expect
    .poll(() => library.read(id))
    .toBe(original.replace("First", "[First](https://example.com)"));
});
