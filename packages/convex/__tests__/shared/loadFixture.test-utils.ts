import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test cases in `fixtures/` that the Apple (TeakCore) and Android (core:model)
 * ports read too, so every port runs the same rows as these tests.
 */
export const loadFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", `${name}.json`), "utf8")
  ) as T;
