import { expect, test } from "@playwright/test";
import { runCli } from "../helpers/cli";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

test("CLI covers auth, cards, tags, and aliases", async () => {
  const apiKey = requireServiceApiKey("cli");
  expect(
    JSON.parse(await runCli(["--json", "auth", "status"], apiKey)).status
  ).toBe("ok");
  const created = JSON.parse(
    await runCli(["--json", "cards", "create", `cli-${Date.now()}`], apiKey)
  );
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
  const apiKey = requireServiceApiKey("cli");
  const marker = `cli-lifecycle-${Date.now()}`;
  const created = JSON.parse(
    await runCli(
      ["--json", "cards", "create", marker, "--tags", "e2e,cli-lifecycle"],
      apiKey
    )
  );
  expect(created.cardId).toBeTruthy();
  updateState((state) => state.createdCardIds.push(created.cardId));

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
  updateState((state) => {
    state.createdCardIds = state.createdCardIds.filter(
      (id) => id !== created.cardId
    );
  });
});
