import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TESTS = join(import.meta.dir, "../Packages/TeakKit/Tests/TeakCoreTests");

// AppLanguage is shared by every suite, and Swift Testing runs suites in
// parallel: each suite says whether it reads English or switches the language
// (Tests/TeakCoreTests/Language.swift).
test("every TeakKit test suite declares how it uses the app's language", () => {
  const missing: string[] = [];
  for (const file of readdirSync(TESTS).filter((name) =>
    name.endsWith(".swift")
  )) {
    const source = readFileSync(join(TESTS, file), "utf8");
    for (const line of source.split("\n")) {
      if (/^\s*@Test\b/.test(line) && !/^\s+/.test(line)) {
        missing.push(`${file}: a @Test outside a suite`);
      }
      const suite = line.match(/^\s*@Suite\b(.*)$/);
      if (suite && !/\.(english|switchesLanguage)\b/.test(suite[1] ?? "")) {
        missing.push(`${file}: ${line.trim()}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
