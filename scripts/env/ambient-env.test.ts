import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ambient dotenv", () => {
  test("supported root scripts opt out of Bun dotenv loading", () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, "../..", "package.json"), "utf-8")
    ) as { scripts: Record<string, string> };
    const supported = Object.entries(packageJson.scripts).filter(([, value]) =>
      value.includes("scripts/")
    );
    expect(supported.length).toBeGreaterThan(0);
    for (const [, value] of supported) {
      expect(value).toContain("--no-env-file");
    }
  });
});
