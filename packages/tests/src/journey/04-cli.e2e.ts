import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { runCli } from "../helpers/cli";
import { cliFileFixtures, materializeFixtures } from "../helpers/file-formats";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

for (const kind of ["repo", "npm"] as const) {
  test(`${kind} CLI covers auth, cards, tags, and aliases`, async () => {
    const apiKey = requireServiceApiKey("cli");
    expect(
      JSON.parse(await runCli(kind, ["--json", "auth", "status"], apiKey))
        .status
    ).toBe("ok");
    const created = JSON.parse(
      await runCli(
        kind,
        ["--json", "cards", "create", `cli-${kind}-${Date.now()}`],
        apiKey
      )
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
      expect(await runCli(kind, args, apiKey)).toBeTruthy();
    }
  });
}

test("repo CLI uploads source, Markdown, ZIP, SVG, GIF, and Figma files", async () => {
  const apiKey = requireServiceApiKey("cli");
  const marker = `cli-file-${Date.now()}`;
  const paths = materializeFixtures(cliFileFixtures(marker));

  for (const filePath of paths) {
    const created = JSON.parse(
      await runCli(
        "repo",
        [
          "--json",
          "add",
          "--file",
          filePath,
          "--tags",
          "prod-e2e,file-formats",
        ],
        apiKey
      )
    );
    expect(created.cardId, filePath).toBeTruthy();
    updateState((state) => state.createdCardIds.push(created.cardId));
    if (filePath.toLowerCase().endsWith(".md")) {
      const fetched = JSON.parse(
        await runCli("repo", ["--json", "cards", "get", created.cardId], apiKey)
      );
      const fixture = cliFileFixtures(marker).find(
        (item) => item.fileName === basename(filePath)
      );
      expect(fetched).toMatchObject({
        content: new TextDecoder().decode(fixture?.bytes),
        fileName: basename(filePath),
        type: "text",
      });
    }
  }
});
