import { Buffer } from "node:buffer";
import { expect, type Page, test } from "@playwright/test";
import { MAX_FILE_SIZE } from "@teak/convex/shared";
import { apiFetch } from "../helpers/api";
import { clientFor } from "../helpers/prod";
import { readState, updateState } from "../helpers/run-state";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

interface FilePayload {
  buffer: Buffer;
  mimeType: string;
  name: string;
}
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);

const saveTextCard = async (page: Page, content: string) => {
  await page.goto("/");
  await page.getByPlaceholder(/Write a note/i).fill(content);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("main").getByText(content).first()).toBeVisible();
};

const enterSearch = async (page: Page, query: string) => {
  const search = page.getByPlaceholder("Search for anything...");
  await search.fill(query);
  await search.press("Enter");
};

const searchFor = async (page: Page, query: string) => {
  await page.goto("/");
  await enterSearch(page, query);
};

const uploadFiles = async (page: Page, files: FilePayload | FilePayload[]) => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Upload files" }).click(),
  ]);
  await chooser.setFiles(files);
};

const waitForHomeUploadSurface = async (page: Page) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Upload files" })
  ).toBeVisible();
  await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
};

const primaryContext = () => {
  const state = readState();
  if (!state.primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  return {
    api: clientFor(state.primary.apiKey),
    apiKey: state.primary.apiKey,
  };
};

const markerFor = (scope: string) =>
  `prod-surface-${scope}-${Date.now().toString(36)}`;

const hasUploadedFile = async (
  apiKey: string,
  fileName: string,
  createdAfter: number
) => {
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
    const params = new URLSearchParams({
      createdAfter: String(createdAfter),
      include: "metadata",
      limit: "100",
      type: "image",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const response = await apiFetch(`/v1/cards?${params.toString()}`, apiKey);
    const payload = (await response.json()) as {
      items?: Array<{
        fileName?: string | null;
        fileUrl?: string | null;
        thumbnailUrl?: string | null;
        type?: string;
      }>;
      pageInfo?: { nextCursor?: string | null };
    };
    if (
      payload.items?.some(
        (card) =>
          card.type === "image" &&
          card.fileName === fileName &&
          (card.fileUrl ?? card.thumbnailUrl)
      )
    ) {
      return true;
    }
    cursor = payload.pageInfo?.nextCursor ?? undefined;
    if (!cursor) {
      return false;
    }
  }
  return false;
};

test("web editor, deep links, and link metadata stay usable", async ({
  page,
}) => {
  const { apiKey } = primaryContext();
  const marker = markerFor("editor");
  await saveTextCard(page, `${marker} original`);
  await page.getByRole("main").getByText(`${marker} original`).click();
  const editor = page.getByPlaceholder("Enter your text...");
  await editor.fill(`# ${marker} updated\n\n- **bold** item\n- \`code\``);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toHaveValue(/updated/);
  const deepLink = page.url();
  const cardId = new URL(deepLink).searchParams.get("card");
  expect(cardId).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByPlaceholder("Enter your text...")).toHaveValue(
    /updated/
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(deepLink);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const searchResponse = await apiFetch(
    `/v1/cards/search?q=${encodeURIComponent(marker)}`,
    apiKey
  );
  const searchPayload = (await searchResponse.json()) as {
    items?: Array<{ content?: string }>;
  };
  expect(
    searchPayload.items?.filter((card) => card.content?.includes(marker))
  ).toHaveLength(1);

  const linkUrl = `https://example.com/?teak=${marker}`;
  await saveTextCard(page, linkUrl);
  await expect
    .poll(
      async () =>
        (
          (await (
            await apiFetch(
              `/v1/cards/search?q=${encodeURIComponent(marker)}`,
              apiKey
            )
          ).json()) as { items?: Array<{ metadataTitle?: string }> }
        ).items?.some((card) =>
          /Example Domain/i.test(card.metadataTitle ?? "")
        ),
      { timeout: 90_000 }
    )
    .toBe(true);
  await searchFor(page, marker);
  await expect(page.getByRole("main").getByText(/Example Domain/i)).toBeVisible(
    { timeout: 30_000 }
  );
});

test("web uploads and paste-created files complete", async ({ page }) => {
  const { apiKey } = primaryContext();
  const marker = markerFor("uploads");
  await waitForHomeUploadSurface(page);
  await uploadFiles(page, [
    { buffer: pdf, mimeType: "application/pdf", name: `${marker}.pdf` },
    {
      buffer: Buffer.from("teak audio"),
      mimeType: "audio/webm",
      name: `${marker}.webm`,
    },
    {
      buffer: Buffer.from("teak video"),
      mimeType: "video/mp4",
      name: `${marker}.mp4`,
    },
  ]);
  await expect(page.getByText(/Uploaded 3 files|File uploaded/)).toBeVisible({
    timeout: 90_000,
  });

  await uploadFiles(page, {
    buffer: Buffer.alloc(MAX_FILE_SIZE + 1),
    mimeType: "application/octet-stream",
    name: `${marker}-too-large.bin`,
  });
  await expect(page.getByText(/Maximum file size is 20MB/i)).toBeVisible();

  await waitForHomeUploadSurface(page);
  const pasteStartedAt = Date.now() - 60_000;
  const pastedFileName = `${marker}-pasted.png`;
  const pasteResult = await page.evaluate(
    ({ base64, fileName }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], fileName, { type: "image/png" });
      const clipboardData = new DataTransfer();
      clipboardData.items.add(file);

      const fallbackEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      const event =
        typeof ClipboardEvent === "function"
          ? new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData,
            })
          : fallbackEvent;

      if (!event.clipboardData) {
        Object.defineProperty(event, "clipboardData", {
          configurable: true,
          value: clipboardData,
        });
      }

      document.body.dispatchEvent(event);

      return {
        defaultPrevented: event.defaultPrevented,
        fileCount: event.clipboardData?.files.length ?? 0,
        itemCount: event.clipboardData?.items.length ?? 0,
      };
    },
    { base64: png.toString("base64"), fileName: pastedFileName }
  );
  expect(pasteResult).toEqual({
    defaultPrevented: true,
    fileCount: 1,
    itemCount: 1,
  });
  await expect
    .poll(() => hasUploadedFile(apiKey, pastedFileName, pasteStartedAt), {
      timeout: 90_000,
    })
    .toBe(true);
});

test("web bulk actions, restore, and empty states stay coherent", async ({
  page,
}) => {
  const { api } = primaryContext();
  const marker = markerFor("bulk");
  const bulkA = await api.cards.create({
    content: `${marker} bulk-a`,
    source: "prod-e2e",
  });
  const bulkB = await api.cards.create({
    content: `${marker} bulk-b`,
    source: "prod-e2e",
  });
  updateState((s) => s.createdCardIds.push(bulkA.cardId, bulkB.cardId));
  await searchFor(page, `${marker} bulk`);
  await page.getByText(`${marker} bulk-a`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select" }).click();
  await page.getByText(`${marker} bulk-b`).click();
  await expect(page.getByText("2 cards selected")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted 2 cards")).toBeVisible({
    timeout: 30_000,
  });

  const restoreCard = await api.cards.create({
    content: `${marker} restore-me`,
    source: "prod-e2e",
  });
  updateState((s) => s.createdCardIds.push(restoreCard.cardId));
  await searchFor(page, `${marker} restore-me`);
  await page.getByText(`${marker} restore-me`).click();
  await page.getByRole("button", { name: "Favorite" }).click();
  await page.getByRole("button", { name: "Manage Tags" }).click();
  const tagsDialog = page.getByRole("dialog", { name: "Manage Tags" });
  await expect(tagsDialog).toBeVisible();
  await tagsDialog.getByLabel("Add New Tag").fill(`${marker}-tag`);
  await tagsDialog.getByRole("button", { name: "Add tag" }).click();
  await expect(tagsDialog.getByText(`${marker}-tag`)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await searchFor(page, "trash");
  await page.getByText(`${marker} restore-me`).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { exact: true, name: "Restore" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await searchFor(page, `${marker} restore-me`);
  await expect(page.getByText(`${marker} restore-me`)).toBeVisible();

  await searchFor(page, `${marker}-no-results`);
  await expect(page.getByText(/nothing found/i)).toBeVisible();
  await page.getByRole("button", { name: "Clear All" }).click();
  await expect(page.getByPlaceholder("Search for anything...")).toHaveValue("");
  await searchFor(page, `${marker}missingtag`);
  await expect(
    page.getByRole("button", { exact: true, name: `${marker}missingtag` })
  ).toBeVisible();
  await expect(page.getByText(/nothing found/i)).toBeVisible();
  await page.getByRole("button", { name: "Clear All" }).click();
  await page.getByRole("button", { name: /Trash/i }).first().click();
  await enterSearch(page, `${marker}-trash-empty`);
  await expect(page.getByText(/nothing found/i)).toBeVisible();
  await page.getByRole("button", { name: "Clear All" }).click();
});

test("settings import and export surface terminal states", async ({ page }) => {
  test.setTimeout(180_000);
  const marker = markerFor("import");
  await page.goto("/settings");
  await page.getByText("Import/Export Data").waitFor();
  await page
    .getByText("Import/Export Data")
    .locator("xpath=ancestor::div[.//button][1]")
    .getByRole("button", { name: "Manage" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Manage Data" });
  await expect(dialog).toContainText("Import or export");
  await dialog.getByRole("tab", { name: "Export" }).click();
  await expect(
    dialog.getByText(/Export your data|Your export is ready/)
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Import" }).click();
  const importPanel = dialog.getByRole("tabpanel", { name: "Import" });
  await expect(
    importPanel.getByRole("button", { name: "Import Bookmarks" })
  ).toBeVisible();
  const [bookmarkChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    importPanel.getByRole("button", { name: "Import Bookmarks" }).click(),
  ]);
  await bookmarkChooser.setFiles({
    buffer: Buffer.from(
      `<!doctype NETSCAPE-Bookmark-file-1><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><DT><A HREF="https://example.com/?teak=${marker}">Example import ${marker}</A></DT></DL>`
    ),
    mimeType: "text/html",
    name: `${marker}-bookmarks.html`,
  });
  await expect(importPanel.getByText(`${marker}-bookmarks.html`)).toBeVisible();
  await importPanel.getByRole("button", { name: "Start import" }).click();
  await expect
    .poll(
      async () => {
        const text = (await importPanel.textContent()) ?? "";
        return (
          /Last import: [1-9]\d* created/i.test(text) &&
          !/Import stopped|failed/i.test(text)
        );
      },
      { timeout: 120_000 }
    )
    .toBe(true);
  await page.keyboard.press("Escape");
});
