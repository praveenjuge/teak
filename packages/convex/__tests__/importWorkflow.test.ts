import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("import workflow", () => {
  test("stops the job on card limit instead of failing every remaining item", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../workflows/import.ts", import.meta.url)),
      "utf8"
    );
    const limitBranch = source.match(
      /if \(result\.limitReached\) \{[\s\S]*?\n      \}/
    )?.[0];

    expect(source).toContain("result.limitReached");
    expect(limitBranch).toContain("CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED");
    expect(limitBranch).toContain('"failed"');
    expect(limitBranch).not.toContain("failRemaining");
    expect(limitBranch).not.toContain('"completed"');
  });
});
