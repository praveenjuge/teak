import { expect, test } from "@playwright/test";
import { runCli } from "../helpers/cli";
import { readState, updateState } from "../helpers/run-state";

for (const kind of ["repo", "npm"] as const) {
  test(`${kind} CLI covers auth, cards, tags, and aliases`, async () => {
    const { primary } = readState();
    if (!primary?.apiKey) {
      throw new Error("Missing primary API key");
    }
    expect(
      JSON.parse(
        await runCli(kind, ["--json", "auth", "status"], primary.apiKey)
      ).status
    ).toBe("ok");
    const created = JSON.parse(
      await runCli(
        kind,
        ["--json", "cards", "create", `cli-${kind}-${Date.now()}`],
        primary.apiKey
      )
    );
    updateState((s) => s.createdCardIds.push(created.cardId));
    for (const args of [
      ["--json", "cards", "list", "--limit", "5"],
      ["--json", "cards", "search", "cli"],
      ["--json", "cards", "favorites"],
      ["--json", "cards", "get", created.cardId],
      ["--json", "tags"],
      ["--json", "ls", "--limit", "1"],
      ["--json", "search", "cli"],
    ]) {
      expect(await runCli(kind, args, primary.apiKey)).toBeTruthy();
    }
  });
}
