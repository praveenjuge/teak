import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, generateTestContent, test } from "./fixtures";

test("-, OR and parentheses narrow the grid, suggest, and survive a reload", async ({
  browser,
  screen,
  library,
}) => {
  const tag = generateTestContent("ops").toLowerCase().replace(/\W+/g, "-");
  const create = async (content: string, tags: string[]) => {
    const id = await library.client.mutation(api.cards.createCard, {
      content,
      type: "text",
      tags: [tag, ...tags],
    });
    library.ids.push(id);
  };
  const PLAIN = "Operator design notes";
  const FIGMA = "Operator design in Figma";
  const FONTS = "Operator font pairing";
  const TYPE = "Operator type specimen";
  const OTHER = "Operator color study";
  await create(PLAIN, []);
  await create(FIGMA, []);
  await create(FONTS, ["fonts"]);
  await create(TYPE, ["type"]);
  await create(OTHER, ["color"]);

  const card = (title: string) =>
    screen.getByRole("button", `: ${title}`, { exact: false });
  const shows = async (visible: string[], hidden: string[]) => {
    for (const title of visible) {
      await expect(card(title)).toBeVisible();
    }
    for (const title of hidden) {
      await expect(card(title)).not.toBeVisible();
    }
  };

  await gotoApp(browser, "/");
  const search = screen.getByRole("combobox");
  await search.fill(`#${tag} design -figma`);
  await expect(card(PLAIN)).toBeVisible({ timeout: 30_000 });
  await shows([PLAIN], [FIGMA, FONTS]);
  await expect(browser).toHaveURL(/q=[^&]*-figma/);

  await search.press("Enter");
  await expect(
    screen.getByRole("button", "Remove excluding figma")
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByRole("button", "Remove excluding figma")
  ).toBeVisible({ timeout: 30_000 });
  await shows([PLAIN], [FIGMA]);
  // The plain word comes back into the search box, the operator as a pill.
  await expect(search).toHaveValue("design");
  await screen.getByRole("button", "Remove excluding figma").click();
  await shows([PLAIN, FIGMA], [FONTS]);
  await search.fill("");

  await search.fill("-");
  await expect(
    screen.getByRole("option", "Leave out cards with a tag", { exact: false })
  ).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(search).toHaveValue("-tag:");
  await search.pressSequentially("font");
  await screen.getByRole("option", "fonts", { exact: false }).click();
  await expect(
    screen.getByRole("button", "Remove excluding tag fonts")
  ).toBeVisible();
  await shows([PLAIN, TYPE, OTHER], [FONTS]);
  await screen.getByRole("button", "Remove excluding tag fonts").click();

  await search.fill("tag:fonts O");
  await expect(
    screen.getByRole("option", "Either side matches", { exact: false })
  ).toBeVisible();
  await search.fill("tag:fonts OR tag:type");
  await shows([FONTS, TYPE], [PLAIN, OTHER]);
  await search.fill("-(tag:fonts OR tag:type)");
  await shows([PLAIN, FIGMA, OTHER], [FONTS, TYPE]);
  await search.fill("(tag:fonts OR design) -figma");
  await shows([FONTS, PLAIN], [FIGMA, TYPE, OTHER]);
});

test("a smart folder's OR and a typed exclusion intersect", async ({
  browser,
  screen,
  library,
}) => {
  const tag = generateTestContent("opsfolder")
    .toLowerCase()
    .replace(/\W+/g, "-");
  for (const [content, tags] of [
    ["Folder font pairing", ["fonts"]],
    ["Folder type specimen", ["type"]],
    ["Folder color study", ["color"]],
  ] as const) {
    library.ids.push(
      await library.client.mutation(api.cards.createCard, {
        content,
        type: "text",
        tags: [tag, ...tags],
      })
    );
  }
  const folder = await library.client.mutation(api.folders.createFolder, {
    name: `Fonts or type ${tag}`,
    kind: "smart",
    query: `#${tag} (tag:fonts OR tag:type)`,
  });
  expect(folder.query).toBe(`tag:${tag} (tag:fonts OR tag:type)`);

  const card = (title: string) =>
    screen.getByRole("button", `: ${title}`, { exact: false });
  await gotoApp(browser, "/");
  await screen.getByRole("link", folder.name).click();
  await expect(card("Folder font pairing")).toBeVisible({ timeout: 30_000 });
  await expect(card("Folder type specimen")).toBeVisible();
  await expect(card("Folder color study")).not.toBeVisible();
  await expect(
    screen.getByText("tag:fonts OR tag:type", { exact: false })
  ).toBeVisible();

  await screen.getByRole("combobox").fill("-tag:fonts");
  await expect(card("Folder font pairing")).not.toBeVisible();
  await expect(card("Folder type specimen")).toBeVisible();
  await expect(card("Folder color study")).not.toBeVisible();
});
