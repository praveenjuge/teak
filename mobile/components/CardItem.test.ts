import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("CardItem passes cardId to getFileUrl", () => {
  const filePath = join(import.meta.dir, "CardItem.tsx");
  const source = readFileSync(filePath, "utf8");

  // Ensure the getFileUrl query includes cardId to enforce ownership checks.
  const hasCardId = /getFileUrl[\s\S]*\{[^}]*cardId\s*:/.test(source);
  expect(hasCardId).toBe(true);
});
