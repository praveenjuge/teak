import { apiFetch } from "../helpers/api";
import { clientFor, createAccount, gotoApp } from "../helpers/app";
import {
  describe,
  expect,
  type Screen,
  type Surface,
  test,
} from "../helpers/test";
import { DIALOG_EDITOR, goToEnd } from "../web/editor-library";

// The placeholder names the open view, so find the box by its role.
const enterSearch = async (screen: Screen, query: string) => {
  const search = screen.getByRole("searchbox");
  await search.fill(query);
};

const searchFor = async ({ browser, screen }: Surface, query: string) => {
  await gotoApp(browser, "/");
  await enterSearch(screen, query);
};

const cardText = (screen: Screen, text: string | RegExp) =>
  screen.getByRole("main").getByText(text, { exact: false }).first();

const expectSearchToFilterCurrentView = async (
  screen: Screen,
  query: string,
  visibleText: string | RegExp
) => {
  const target = cardText(screen, visibleText);
  const missingQuery = `zzzz-no-match-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  await expect(target).toBeVisible({ timeout: 30_000 });
  await enterSearch(screen, missingQuery);
  await expect(target).not.toBeVisible();
  await expect(
    screen.getByRole("main").getByText(/nothing found/i)
  ).toBeVisible();
  await enterSearch(screen, query);
  await expect(target).toBeVisible();
};

const searchForVisibleCard = async (
  surface: Surface,
  query: string,
  visibleText: string | RegExp
) => {
  await gotoApp(surface.browser, "/");
  await expectSearchToFilterCurrentView(surface.screen, query, visibleText);
};

const clearFilters = async (screen: Screen) => {
  await screen
    .getByRole("button", /Clear (All|filters)/i)
    .first()
    .click();
};

// Typing `trash` in search opens the Trash page.
const showTrash = async ({ browser, screen }: Surface) => {
  await gotoApp(browser, "/");
  const search = screen.getByRole("searchbox");
  await search.fill("trash");
  await search.press("Enter");
  await expect(screen.getByPlaceholder("Search Trash...")).toBeVisible();
  await expect(screen.getByRole("link", "Trash")).toHaveAttribute(
    "aria-current",
    "page"
  );
};

const markerFor = (scope: string) =>
  `e2e-surface-${scope}-${Date.now().toString(36)}`;

// One fresh account for the file, created by the first test and kept for the
// rest of the group.
let apiKey = "";

const surfaceContext = () => {
  expect(apiKey, "web-surfaces API key").toMatch(/^teakapi_/);
  return { api: clientFor(apiKey), apiKey };
};

describe("web product surfaces", { serial: true }, () => {
  test("web editor, deep links, and link metadata stay usable", {
    timeout: 180_000,
  }, async ({ browser, screen }) => {
    const surface = { browser, screen };
    apiKey = (await createAccount(surface, "web-surfaces")).apiKey ?? "";
    const { api } = surfaceContext();
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
    await gotoApp(browser, `/?card=${created.cardId}`);
    const dialog = screen.getByRole("dialog");
    const editor = dialog.getByRole("textbox", "Markdown content", {
      exact: false,
    });
    await expect(
      dialog.getByRole("heading", `${marker} updated`, { exact: false })
    ).toBeVisible();
    await dialog.getByRole("checkbox").first().check();
    for (const checkbox of await dialog.getByRole("checkbox").all()) {
      await expect(checkbox).toBeChecked();
    }
    await goToEnd(browser, DIALOG_EDITOR);
    await editor.press("Enter");
    await editor.pressSequentially("continued task");
    await editor.press("Enter");
    await editor.press("Enter");
    await editor.pressSequentially("toolbar strike");
    for (const _character of "strike") {
      await editor.press("Shift+ArrowLeft");
    }
    await dialog.getByRole("button", "Strikethrough", { exact: false }).click();
    await expect(browser.locator(`${DIALOG_EDITOR} s`)).toHaveCount(2);
    const documentLink = dialog.getByRole("link", "Teak docs");
    await expect(documentLink).toHaveAttribute(
      "href",
      "https://teakvault.com/docs"
    );
    await documentLink.dblclick();
    await browser.evaluate(
      () =>
        new Promise<null>((resolve) =>
          requestAnimationFrame(() => resolve(null))
        )
    );
    await browser.keyboard.press("ControlOrMeta+k");
    const url = dialog.getByRole("textbox", "Link URL", { exact: false });
    await expect(url).toHaveValue("https://teakvault.com/docs");
    await url.fill("https://example.com/edited");
    await dialog.getByRole("button", "Apply").click();
    await expect(documentLink).toHaveAttribute(
      "href",
      "https://example.com/edited"
    );
    await screen.getByRole("button", "Save changes", { exact: false }).click();
    await expect(editor).toContainText("updated");
    await expect(browser).toHaveURL(/[?&]card=[^&]+/);
    const deepLink = await browser.url();
    const cardId = new URL(deepLink).searchParams.get("card") ?? "";
    expect(cardId).toBeTruthy();
    await expect
      .poll(async () => (await api.cards.get(cardId)).content)
      .toContain("- [x] clickable task");
    const saved = (await api.cards.get(cardId)).content;
    expect(saved).toContain("[Teak docs](https://example.com/edited)");
    expect(saved).toContain("- [ ] continued task");
    expect(saved).toContain("toolbar ~~strike~~");
    expect(saved).toContain("https://example.com/editor");
    await browser.reload();
    await expect(screen.getByRole("dialog")).toBeVisible();
    await expect(
      screen
        .getByRole("dialog")
        .getByRole("textbox", "Markdown content", { exact: false })
    ).toContainText("updated");
    await browser.keyboard.press("Escape");
    await expect(screen.getByRole("dialog")).not.toBeVisible();
    await browser.goto(deepLink);
    await expect(screen.getByRole("dialog")).toBeVisible();
    await browser.keyboard.press("Escape");
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
    await searchForVisibleCard(surface, marker, `${marker} link`);
    // Without a Files Worker there is no screenshot, so the card keeps
    // showing its text; the fetched page title still lands on the card.
    await expect
      .poll(async () => (await api.cards.get(link.cardId)).metadataTitle, {
        timeout: 90_000,
      })
      .toBe("Example Domain");
  });

  test("web bulk actions, restore, and empty states stay coherent", async ({
    browser,
    screen,
  }) => {
    const surface = { browser, screen };
    const { api } = surfaceContext();
    const marker = markerFor("bulk");
    await api.cards.create({
      content: `${marker} bulk-a`,
      source: "e2e",
    });
    await api.cards.create({
      content: `${marker} bulk-b`,
      source: "e2e",
    });
    await searchForVisibleCard(surface, `${marker} bulk`, `${marker} bulk-a`);
    await screen.getByText(`${marker} bulk-a`, { exact: false }).secondaryTap();
    await screen.getByRole("menuitem", "Select", { exact: false }).click();
    await screen.getByText(`${marker} bulk-b`, { exact: false }).click();
    await expect(
      screen.getByText("2 cards selected", { exact: false })
    ).toBeVisible();
    // Move to Trash sits in the bulk bar's More menu.
    await screen.getByRole("button", "More actions").click();
    await screen.getByRole("menuitem", "Move to Trash").click();
    await expect(
      screen.getByText("Moved 2 cards to Trash", { exact: false })
    ).toBeVisible({
      timeout: 30_000,
    });

    await api.cards.create({
      content: `${marker} restore-me`,
      source: "e2e",
    });
    await searchForVisibleCard(
      surface,
      `${marker} restore-me`,
      `${marker} restore-me`
    );
    await screen.getByText(`${marker} restore-me`, { exact: false }).click();
    await screen.getByRole("button", "Favorite", { exact: false }).click();
    await screen.getByRole("button", "Manage Tags", { exact: false }).click();
    const tagsDialog = screen.getByRole("dialog", "Manage Tags", {
      exact: false,
    });
    await expect(tagsDialog).toBeVisible();
    await tagsDialog
      .getByLabel("Add New Tag", { exact: false })
      .fill(`${marker}-tag`);
    await tagsDialog.getByRole("button", "Add tag", { exact: false }).click();
    await expect(
      tagsDialog.getByText(`${marker}-tag`, { exact: false })
    ).toBeVisible();
    await browser.keyboard.press("Escape");
    await screen.getByRole("button", "Delete", { exact: false }).click();
    await expect(screen.getByRole("dialog")).not.toBeVisible();
    await showTrash(surface);
    await screen.getByText(`${marker} restore-me`, { exact: false }).click();
    await screen.getByRole("dialog").getByRole("button", "Restore").click();
    await expect(screen.getByRole("dialog")).not.toBeVisible();
    await searchForVisibleCard(
      surface,
      `${marker} restore-me`,
      `${marker} restore-me`
    );

    await screen.getByText(`${marker} restore-me`, { exact: false }).click();
    await screen
      .getByRole("dialog")
      .getByRole("button", `${marker}-tag`)
      .click();
    await expect(screen.getByRole("button", `${marker}-tag`)).toBeVisible();
    await expect(
      screen.getByText(`${marker} restore-me`, { exact: false })
    ).toBeVisible();
    await enterSearch(screen, `${marker}-tag-empty`);
    await expect(screen.getByRole("button", `${marker}-tag`)).toBeVisible();
    await expect(cardText(screen, `${marker} restore-me`)).not.toBeVisible();
    await expect(
      screen.getByRole("main").getByText(/nothing found/i)
    ).toBeVisible();
    await clearFilters(screen);

    await searchFor(surface, `${marker}-no-results`);
    await expect(screen.getByText(/nothing found/i)).toBeVisible();
    await clearFilters(screen);
    await expect(screen.getByPlaceholder("Search for anything...")).toHaveValue(
      ""
    );
    await showTrash(surface);
    await expectSearchToFilterCurrentView(
      screen,
      `${marker} bulk-a`,
      `${marker} bulk-a`
    );
    await enterSearch(screen, `${marker}-trash-empty`);
    await expect(screen.getByText(/nothing found/i)).toBeVisible();
    await clearFilters(screen);
  });
});
