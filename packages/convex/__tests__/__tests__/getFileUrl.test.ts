import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("getFileUrl enforces auth and card ownership checks", () => {
  const filePath = join(
    new URL(".", import.meta.url).pathname,
    "../../../convex/card/getFileUrl.ts"
  );
  const source = readFileSync(filePath, "utf8");

  const requiresKey = /key:\s*v\.string\(\)/.test(source);
  const requiresCardId = /cardId:\s*v\.id\("cards"\)/.test(source);
  const requiresAuth = /if\s*\(\s*!user\s*\)/.test(source);
  const checksOwnership = /card\.userId\s*!==\s*user\.subject/.test(source);
  const checksFileMatch =
    /card\.fileKey\s*===\s*args\.key/.test(source) &&
    /card\.thumbnailKey\s*===\s*args\.key/.test(source) &&
    /linkPreview\?\.screenshotStorageKey\s*===\s*args\.key/.test(source) &&
    /linkPreview\?\.imageStorageKey\s*===\s*args\.key/.test(source);

  expect(requiresKey).toBe(true);
  expect(requiresCardId).toBe(true);
  expect(requiresAuth).toBe(true);
  expect(checksOwnership).toBe(true);
  expect(checksFileMatch).toBe(true);
});
