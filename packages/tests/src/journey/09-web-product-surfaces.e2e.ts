import type { Page } from "@playwright/test";
import { apiFetch } from "../helpers/api";
import { clientFor } from "../helpers/app";
import { readState, updateState } from "../helpers/run-state";
import { expect, test } from "../helpers/test";

const enterSearch = async (page: Page, query: string) => {
  const search = page.getByPlaceholder("Search for anything...");
  await search.fill(query);
};

const searchFor = async (page: Page, query: string) => {
  await page.goto("/");
  await enterSearch(page, query);
};

const cardText = (page: Page, text: string | RegExp) =>
  page.getByRole("main").getByText(text).first();

const expectSearchToFilterCurrentView = async (
  page: Page,
  query: string,
  visibleText: string | RegExp
) => {
  const target = cardText(page, visibleText);
  const missingQuery = `zzzz-no-match-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  await expect(target).toBeVisible({ timeout: 30_000 });
  await enterSearch(page, missingQuery);
  await expect(target).not.toBeVisible();
  await expect(
    page.getByRole("main").getByText(/nothing found/i)
  ).toBeVisible();
  await enterSearch(page, query);
  await expect(target).toBeVisible();
};

const searchForVisibleCard = async (
  page: Page,
  query: string,
  visibleText: string | RegExp
) => {
  await page.goto("/");
  await expectSearchToFilterCurrentView(page, query, visibleText);
};

const clearFilters = async (page: Page) => {
  await page
    .getByRole("button", { name: /Clear (All|filters)/i })
    .first()
    .click();
};

const showTrash = async (page: Page) => {
  await page.goto("/");
  const search = page.getByPlaceholder("Search for anything...");
  await search.fill("trash");
  await search.press("Enter");
  await expect(
    page.getByRole("button", { exact: true, name: "Trash" }).first()
  ).toBeVisible();
};

const primaryContext = () => {
  const state = readState();
  const surfacesAccount = state.webSurfaces ?? state.primary;
  if (!surfacesAccount?.apiKey) {
    throw new Error("Missing web-surfaces API key");
  }
  return {
    api: clientFor(surfacesAccount.apiKey),
    apiKey: surfacesAccount.apiKey,
  };
};

const markerFor = (scope: string) =>
  `e2e-surface-${scope}-${Date.now().toString(36)}`;

test("web editor, deep links, and link metadata stay usable", async ({
  page,
}) => {
  const { api, apiKey } = primaryContext();
  const marker = markerFor("editor");
  const initialMarkdown = `# ${marker} updated

- [ ] clickable task
- [x] finished task

[Teak docs](https://teakvault.com/docs)

https://example.com/editor

~~already struck~~

- [x] completed seed`;
  const created = await api.cards.create({
    content: initialMarkdown,
    cardType: "text",
    source: "e2e",
  });
  updateState((state) => state.createdCardIds.push(created.cardId));
  await page.goto(`/?card=${created.cardId}`);
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Markdown content" });
  await expect(
    dialog.getByRole("heading", { name: `${marker} updated` })
  ).toBeVisible();
  await dialog.getByRole("checkbox").first().check();
  for (const checkbox of await dialog.getByRole("checkbox").all()) {
    await expect(checkbox).toBeChecked();
  }
  await editor.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (element as HTMLElement).focus();
  });
  await editor.press("Enter");
  await editor.pressSequentially("continued task");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("toolbar strike");
  for (const _character of "strike") {
    await editor.press("Shift+ArrowLeft");
  }
  await dialog.getByRole("button", { name: "Strikethrough" }).click();
  await expect(editor.locator("s")).toHaveCount(2);
  const documentLink = dialog.getByRole("link", {
    name: "Teak docs",
    exact: true,
  });
  await expect(documentLink).toHaveAttribute(
    "href",
    "https://teakvault.com/docs"
  );
  await documentLink.dblclick();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
  await page.keyboard.press("ControlOrMeta+k");
  const url = dialog.getByRole("textbox", { name: "Link URL" });
  await expect(url).toHaveValue("https://teakvault.com/docs");
  await url.fill("https://example.com/edited");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(documentLink).toHaveAttribute(
    "href",
    "https://example.com/edited"
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toContainText("updated");
  await expect(page).toHaveURL(/[?&]card=[^&]+/);
  const deepLink = page.url();
  const cardId = new URL(deepLink).searchParams.get("card");
  expect(cardId).toBeTruthy();
  await expect
    .poll(async () => (await api.cards.get(cardId!)).content)
    .toContain("- [x] clickable task");
  const saved = (await api.cards.get(cardId!)).content;
  expect(saved).toContain("[Teak docs](https://example.com/edited)");
  expect(saved).toContain("- [ ] continued task");
  expect(saved).toContain("toolbar ~~strike~~");
  expect(saved).toContain("https://example.com/editor");
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("textbox", { name: "Markdown content" })
  ).toContainText("updated");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(deepLink);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const searchResponse = await apiFetch(
    `/v1/cards?include=content&q=${encodeURIComponent(marker)}`,
    apiKey
  );
  const searchPayload = (await searchResponse.json()) as {
    items?: Array<{ content?: string }>;
  };
  expect(
    searchPayload.items?.filter((card) => card.content?.includes(marker))
  ).toHaveLength(1);

  const link = await api.cards.create({
    content: `${marker} link`,
    source: "e2e",
    url: "https://example.com",
  });
  updateState((s) => s.createdCardIds.push(link.cardId));
  await searchForVisibleCard(page, marker, `${marker} link`);
  // Without a Files Worker there is no screenshot, so the card keeps showing
  // its text; the fetched page title still lands on the card.
  await expect
    .poll(async () => (await api.cards.get(link.cardId)).metadataTitle, {
      timeout: 90_000,
    })
    .toBe("Example Domain");
});

test("web bulk actions, restore, and empty states stay coherent", async ({
  page,
}) => {
  const { api } = primaryContext();
  const marker = markerFor("bulk");
  const bulkA = await api.cards.create({
    content: `${marker} bulk-a`,
    source: "e2e",
  });
  const bulkB = await api.cards.create({
    content: `${marker} bulk-b`,
    source: "e2e",
  });
  updateState((s) => s.createdCardIds.push(bulkA.cardId, bulkB.cardId));
  await searchForVisibleCard(page, `${marker} bulk`, `${marker} bulk-a`);
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
    source: "e2e",
  });
  updateState((s) => s.createdCardIds.push(restoreCard.cardId));
  await searchForVisibleCard(
    page,
    `${marker} restore-me`,
    `${marker} restore-me`
  );
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
  await showTrash(page);
  await page.getByText(`${marker} restore-me`).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { exact: true, name: "Restore" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await searchForVisibleCard(
    page,
    `${marker} restore-me`,
    `${marker} restore-me`
  );

  await page.getByText(`${marker} restore-me`).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { exact: true, name: `${marker}-tag` })
    .click();
  await expect(
    page.getByRole("button", { exact: true, name: `${marker}-tag` })
  ).toBeVisible();
  await expect(page.getByText(`${marker} restore-me`)).toBeVisible();
  await enterSearch(page, `${marker}-tag-empty`);
  await expect(
    page.getByRole("button", { exact: true, name: `${marker}-tag` })
  ).toBeVisible();
  await expect(cardText(page, `${marker} restore-me`)).not.toBeVisible();
  await expect(
    page.getByRole("main").getByText(/nothing found/i)
  ).toBeVisible();
  await clearFilters(page);

  await searchFor(page, `${marker}-no-results`);
  await expect(page.getByText(/nothing found/i)).toBeVisible();
  await clearFilters(page);
  await expect(page.getByPlaceholder("Search for anything...")).toHaveValue("");
  await showTrash(page);
  await expectSearchToFilterCurrentView(
    page,
    `${marker} bulk-a`,
    `${marker} bulk-a`
  );
  await enterSearch(page, `${marker}-trash-empty`);
  await expect(page.getByText(/nothing found/i)).toBeVisible();
  await clearFilters(page);
});
