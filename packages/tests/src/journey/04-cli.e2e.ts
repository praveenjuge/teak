import { apiFetch } from "../helpers/api";
import { createApiAccount } from "../helpers/app";
import { runCli } from "../helpers/cli";
import { seedScenario } from "../helpers/seed";
import { expect, retry, test } from "../helpers/test";

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

test("CLI pins cards, lists them in order, reorders and unpins", async () => {
  const marker = `cli-pins-${Date.now()}`;
  const make = async (suffix: string) =>
    JSON.parse(
      await runCli(["--json", "cards", "create", `${marker}-${suffix}`], apiKey)
    ).cardId as string;
  const first = await make("first");
  const second = await make("second");

  await runCli(["--json", "pin", first], apiKey);
  await runCli(["--json", "cards", "pin", second], apiKey);
  const listed = JSON.parse(await runCli(["--json", "cards", "pins"], apiKey));
  expect(listed.items.map((card: { id: string }) => card.id)).toEqual([
    second,
    first,
  ]);

  const reordered = JSON.parse(
    await runCli(["--json", "cards", "pins", "order", first, second], apiKey)
  );
  expect(reordered.map((card: { id: string }) => card.id)).toEqual([
    first,
    second,
  ]);

  const unpinned = JSON.parse(
    await runCli(["--json", "pin", first, "--remove"], apiKey)
  );
  expect(unpinned.isPinned).toBe(false);
  const searched = JSON.parse(
    await runCli(["--json", "ls", "-q", `is:pinned ${marker}`], apiKey)
  );
  expect(searched.items.map((card: { id: string }) => card.id)).toEqual([
    second,
  ]);
});

test("CLI marks a link done, finds it with is:done, and undoes it", async () => {
  const url = `https://example.com/cli-done-${Date.now()}`;
  const created = JSON.parse(
    await runCli(["--json", "cards", "create", url], apiKey)
  );
  const done = JSON.parse(
    await runCli(["--json", "done", created.cardId], apiKey)
  );
  expect(done.completedAt).toEqual(expect.any(Number));

  const listsDone = async () =>
    (
      JSON.parse(await runCli(["--json", "cards", "search", "is:done"], apiKey))
        .items ?? []
    ).some((card: { id?: string }) => card.id === created.cardId);
  expect(await listsDone()).toBe(true);

  const undone = JSON.parse(
    await runCli(["--json", "cards", "done", created.cardId, "--undo"], apiKey)
  );
  expect(undone.completedAt).toBeNull();
  expect(await listsDone()).toBe(false);
});

test("CLI save-pdf refuses a note", async () => {
  const note = JSON.parse(
    await runCli(
      ["--json", "cards", "create", `cli save pdf ${Date.now()}`],
      apiKey
    )
  );
  const refused = await runCli(["cards", "save-pdf", note.cardId], apiKey).then(
    () => "",
    (error: Error) => error.message
  );
  expect(refused).toContain("This card has no PDF to save.");
});

test("teak links lists a card's links and the notes that link to it", async () => {
  const stamp = Date.now();
  const target = JSON.parse(
    await runCli(
      ["--json", "cards", "create", `cli-link-target-${stamp}`],
      apiKey
    )
  );
  const note = JSON.parse(
    await runCli(
      [
        "--json",
        "cards",
        "create",
        `See [[Target|teak:${target.cardId}]] ${stamp}`,
      ],
      apiKey
    )
  );
  await retry(
    async () => {
      expect(await runCli(["links", note.cardId], apiKey)).toContain(
        `${target.cardId}  text      cli-link-target-${stamp}`
      );
      expect(await runCli(["links", target.cardId], apiKey)).toContain(
        `Linked from\n${note.cardId}  text`
      );
    },
    { timeout: 30_000 }
  );

  await runCli(
    [
      "cards",
      "update",
      target.cardId,
      "--content",
      `cli-link-renamed-${stamp}`,
    ],
    apiKey
  );
  expect(await runCli(["links", target.cardId], apiKey)).toContain(
    `${note.cardId}  text      See cli-link-renamed-${stamp} ${stamp}`
  );
});

test("teak highlights adds a passage by its quote, lists, notes and removes it", async () => {
  const { apiKey: readerKey, email } = await createApiAccount("cli-highlights");
  await seedScenario(email, "reader-mix");
  let cardId = "";
  await retry(
    async () => {
      const response = await apiFetch(
        "/v1/cards?q=%23scenario-reader&include=metadata&limit=50",
        readerKey
      );
      const { items } = (await response.json()) as {
        items: Array<{ article: unknown; id: string; url: string | null }>;
      };
      const research = items.find((item) =>
        item.url?.startsWith("https://example.com/reader/research")
      );
      expect(research?.article).toBeTruthy();
      cardId = research?.id ?? "";
    },
    { timeout: 60_000 }
  );

  const added = JSON.parse(
    await runCli(
      [
        "--json",
        "highlights",
        "add",
        cardId,
        "kept 31% more moisture in July",
        "--note",
        "Worth trying",
      ],
      readerKey
    )
  );
  expect(added).toMatchObject({
    anchored: true,
    note: "Worth trying",
    quote: "kept 31% more moisture in July",
  });

  expect(await runCli(["highlights", "list", cardId], readerKey)).toBe(
    `${added.id}  kept 31% more moisture in July\n    Worth trying`
  );
  await runCli(["highlights", "note", added.id, "--clear"], readerKey);
  expect(
    JSON.parse(
      await runCli(["--json", "highlights", "list", cardId], readerKey)
    ).items[0].note
  ).toBeNull();
  expect(await runCli(["highlights", "rm", added.id], readerKey)).toBe(
    `Removed highlight ${added.id}`
  );
});
