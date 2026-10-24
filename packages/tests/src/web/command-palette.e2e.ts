import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, generateTestContent, test } from "./fixtures";

const pathOf = async (url: Promise<string>) => new URL(await url).pathname;

test("the command palette goes to folders and cards, and leaves the editor its ⌘K", async ({
  browser,
  screen,
  library,
}) => {
  const marker = generateTestContent("Palette");
  library.ids.push(
    await library.client.mutation(api.cards.createCard, {
      content: `${marker} card`,
      type: "text",
    })
  );
  const folderName = `Palette folder ${Date.now()}`;
  await library.client.mutation(api.folders.createFolder, { name: folderName });

  const press = (key: string) => browser.keyboard.press(key);
  const palette = screen.getByRole("dialog", "Command palette");
  const input = screen.getByRole(
    "combobox",
    "Search commands, folders and cards"
  );

  await gotoApp(browser, "/");
  await expect(
    screen.getByRole("button", `Text: ${marker} card`, { exact: false })
  ).toBeVisible({ timeout: 30_000 });

  await press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
  await expect(input).toBeFocused();
  await input.pressSequentially(folderName);
  await expect(screen.getByRole("option", folderName)).toBeVisible();
  await press("Enter");
  await expect(palette).toBeHidden();
  await expect.poll(() => pathOf(browser.url())).toMatch(/^\/f\//);
  await expect(screen.getByPlaceholder(`Search ${folderName}`)).toBeVisible();

  await press("ControlOrMeta+k");
  await input.pressSequentially(marker);
  const cardRow = screen.getByRole("option", `${marker} card`, {
    exact: false,
  });
  await expect(cardRow).toBeVisible({ timeout: 30_000 });
  await expect(cardRow).toHaveAttribute("aria-selected", "true");
  await press("Enter");
  const cardModal = screen.getByRole("dialog", "Note");
  await expect(cardModal).toBeVisible({ timeout: 30_000 });
  await expect(
    cardModal.getByText(`${marker} card`, { exact: false }).first()
  ).toBeVisible();
  expect(await pathOf(browser.url())).toMatch(/^\/f\//);
  expect(new URL(await browser.url()).searchParams.get("card")).toBe(
    library.ids[0]
  );

  await press("ControlOrMeta+k");
  await expect(palette).toBeHidden();
  await press("Escape");

  await gotoApp(browser, "/");
  await expect(
    screen.getByRole("button", `Text: ${marker} card`, { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await press("/");
  const search = screen.getByRole("combobox", "Search everything");
  await expect(search).toBeFocused();
  await press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
  await press("Escape");
  await expect(palette).toBeHidden();
  await expect(search).toBeFocused();

  await search.fill("");
  await browser.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    return null;
  });
  await press("n");
  const composer = screen.getByRole("textbox", "Markdown content", {
    exact: false,
  });
  await expect(composer).toBeFocused({ timeout: 30_000 });
  await composer.pressSequentially("a link");
  await press("ControlOrMeta+a");
  await press("ControlOrMeta+k");
  await expect(screen.getByRole("textbox", "Link URL")).toBeVisible();
  await expect(palette).toBeHidden();
});

test("Export in the palette opens Settings at its Export section", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/settings");
  await expect(screen.getByRole("button", "Sign out")).toBeEnabled({
    timeout: 30_000,
  });
  await browser.keyboard.press("ControlOrMeta+k");
  const input = screen.getByRole(
    "combobox",
    "Search commands, folders and cards"
  );
  await input.pressSequentially("export");
  await browser.keyboard.press("Enter");
  await expect(screen.getByRole("region", "Export")).toBeVisible();
  await expect
    .poll(async () => {
      const url = new URL(await browser.url());
      return `${url.pathname}${url.search}${url.hash}`;
    })
    .toBe("/settings/data#export");
});

test("an old Settings dialog link opens the page that replaced it", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/settings?dialog=import");
  await expect(screen.getByRole("region", "Import")).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => new URL(await browser.url()).pathname)
    .toBe("/settings/data");
});
