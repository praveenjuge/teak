import { createApiAccount } from "../helpers/app";
import { runCli } from "../helpers/cli";
import { expect, test } from "../helpers/test";

let apiKey = "";
test.beforeAll(async () => {
  ({ apiKey } = await createApiAccount("service-cli"));
});

test("CLI covers auth, cards, tags, and aliases", async () => {
  expect(
    JSON.parse(await runCli(["--json", "auth", "status"], apiKey)).status
  ).toBe("ok");
  const content = `cli-${Date.now()}`;
  const created = JSON.parse(
    await runCli(["--json", "cards", "create", content], apiKey)
  );
  expect(await runCli(["content", created.cardId], apiKey)).toBe(content);
  for (const args of [
    ["--json", "cards", "list", "--limit", "5"],
    ["--json", "cards", "search", "cli"],
    ["--json", "cards", "favorites"],
    ["--json", "cards", "get", created.cardId],
    ["--json", "tags"],
    ["--json", "ls", "--limit", "1"],
    ["--json", "search", "cli"],
  ]) {
    expect(await runCli(args, apiKey)).toBeTruthy();
  }
});

test("CLI favorites, unfavorites, searches, deletes, and lists tags", async () => {
  const marker = `cli-lifecycle-${Date.now()}`;
  const created = JSON.parse(
    await runCli(
      ["--json", "cards", "create", marker, "--tags", "e2e,cli-lifecycle"],
      apiKey
    )
  );
  expect(created.cardId).toBeTruthy();

  await runCli(["--json", "cards", "favorite", created.cardId], apiKey);
  const favorites = JSON.parse(
    await runCli(["--json", "cards", "favorites"], apiKey)
  );
  expect(
    (favorites.items ?? []).some(
      (card: { id?: string }) => card.id === created.cardId
    )
  ).toBe(true);

  const searched = JSON.parse(
    await runCli(["--json", "cards", "search", marker], apiKey)
  );
  expect(
    (searched.items ?? []).some(
      (card: { id?: string; content?: string }) =>
        card.id === created.cardId || card.content?.includes(marker)
    )
  ).toBe(true);

  const tags = JSON.parse(await runCli(["--json", "tags"], apiKey));
  expect(
    (tags.items ?? []).some(
      (tag: { name?: string }) => tag.name === "cli-lifecycle"
    )
  ).toBe(true);

  await runCli(
    ["--json", "cards", "favorite", created.cardId, "--remove"],
    apiKey
  );
  await runCli(["--json", "cards", "delete", created.cardId], apiKey);
});
