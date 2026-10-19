import {
  clientFor,
  createAccount,
  expectVault,
  gotoApp,
  onScreenText,
} from "../helpers/app";
import { runCli } from "../helpers/cli";
import { connectMcp } from "../helpers/mcp";
import { expect, test } from "../helpers/test";

test("organize a library across the web, API, CLI and MCP", {
  timeout: 300_000,
}, async ({ browser, screen }) => {
  const account = await createAccount({ browser, screen }, "organize");
  const apiKey = account.apiKey ?? "";
  const api = clientFor(apiKey);
  const marker = `org${Date.now().toString(36)}`;
  const first = `${marker} first note`;
  const second = `${marker} second note`;
  const firstCard = await api.cards.create({
    content: first,
    tags: ["inspo"],
  });
  await api.cards.create({ content: second, tags: ["elsewhere"] });

  await gotoApp(browser, "/");
  await expectVault({ browser, screen });
  await screen.getByRole("button", "New folder").first().click();
  await screen.getByLabel("New folder name").fill("Organize");
  await screen.getByLabel("New folder name").press("Enter");
  await expect(screen.getByRole("link", "Organize")).toBeVisible();
  await expect(screen.getByText(first, { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await screen.getByText(first, { exact: false }).secondaryTap();
  await screen.getByRole("menuitem", "Select", { exact: false }).click();
  await screen.getByText(second, { exact: false }).click();
  await expect(
    screen.getByText("2 cards selected", { exact: false })
  ).toBeVisible();
  await screen.getByRole("button", "More actions").click();
  await screen.getByRole("menuitem", "Add to folder…").click();
  await screen.getByRole("option", "Organize", { exact: false }).click();
  await expect(
    screen.getByText("Added 2 cards to Organize", { exact: false })
  ).toBeVisible({ timeout: 30_000 });

  const folder = (await api.folders.list()).items.find(
    (item) => item.name === "Organize"
  );
  expect(folder, "the folder made on the web").toBeDefined();
  const folderId = folder?.id ?? "";
  await expect
    .poll(async () => (await api.folders.get(folderId)).cardCount, {
      timeout: 30_000,
    })
    .toBe(2);
  const shown = await runCli(["folders", "get", "organize"], apiKey);
  expect(shown.trim().split(/\s+/)).toEqual([folderId, "2", "Organize"]);
  const mcp = await connectMcp(apiKey);
  try {
    const fromMcp: any = await mcp.callTool({
      name: "teak_v1_get_folder",
      arguments: { folderId },
    });
    expect(fromMcp.structuredContent).toMatchObject({
      id: folderId,
      name: "Organize",
      cardCount: 2,
    });

    await screen.getByRole("link", "Tags").click();
    await screen.getByRole("button", "More for inspo").click({
      timeout: 60_000,
    });
    await screen.getByRole("menuitem", "Rename…").click();
    const rename = screen.getByRole("dialog", "Rename tag");
    await rename.getByLabel("New name").fill("inspiration");
    await rename.getByRole("button", "Rename").click();
    await expect(
      screen.getByText("Renamed “inspo” to “inspiration”", { exact: false })
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await api.cards.get(firstCard.cardId)).tags, {
        timeout: 30_000,
      })
      .toEqual(["inspiration"]);

    await gotoApp(browser, "/?q=tag%3Ainspiration");
    await expect(screen.getByText(first, { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await screen.getByRole("button", /^View/).click();
    await screen.getByRole("menuitem", "Save as smart folder…").click();
    const save = screen.getByRole("dialog", "Save as smart folder");
    await save.getByLabel("Name").fill("Inspiration");
    await save.getByRole("button", "Save smart folder").click();
    await screen.getByRole("link", "Inspiration").click();
    await expect(screen.getByPlaceholder("Search Inspiration")).toBeVisible();
    await expect(onScreenText(screen, first)).toBeVisible({ timeout: 30_000 });
    await expect(onScreenText(screen, second)).not.toBeVisible();
    const later = `${marker} saved later`;
    await runCli(["add", later, "--tags", "inspiration"], apiKey);
    await expect(onScreenText(screen, later)).toBeVisible({ timeout: 30_000 });
    const smart = (await api.folders.list()).items.find(
      (item) => item.name === "Inspiration"
    );
    expect(smart?.kind).toBe("smart");
    const inSmart = await api.cards.list({
      folder: smart?.id ?? "",
      include: "content",
    });
    expect(inSmart.items.map((card) => card.content).sort()).toEqual(
      [first, later].sort()
    );

    await api.cards.setArchived(firstCard.cardId, true);
    await screen.getByRole("link", "Organize").click();
    await expect(screen.getByText("1 card", { visible: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(screen.getByText(first, { exact: false })).toHaveCount(0);
    await expect
      .poll(async () => (await api.folders.get(folderId)).cardCount, {
        timeout: 30_000,
      })
      .toBe(1);
    const listed: any = await mcp.callTool({
      name: "teak_v1_list_cards",
      arguments: { folder: folderId },
    });
    expect(
      listed.structuredContent.items.map(
        (card: { content: string }) => card.content
      )
    ).toEqual([second]);
    const archived: any = await mcp.callTool({
      name: "teak_v1_list_cards",
      arguments: { folder: folderId, archived: "only" },
    });
    expect(
      archived.structuredContent.items.map(
        (card: { content: string }) => card.content
      )
    ).toEqual([first]);
    await screen.getByRole("link", "Archive").click();
    await expect(onScreenText(screen, first)).toBeVisible({ timeout: 30_000 });
  } finally {
    await mcp.close();
  }
});
