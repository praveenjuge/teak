import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("getFileUrl enforces auth and card ownership checks", () => {
  const filePath = join(
    new URL(".", import.meta.url).pathname,
    "../../../convex/card/getFileUrl.ts",
  );
  const source = readFileSync(filePath, "utf8");

  const requiresCardId = /cardId:\s*v\.id\("cards"\)/.test(source);
  const requiresAuth = /if\s*\(\s*!user\s*\)/.test(source);
  const checksOwnership = /card\.userId\s*!==\s*user\.subject/.test(source);
  const checksFileMatch =
    /card\.fileId\s*===\s*args\.fileId/.test(source) &&
    /card\.thumbnailId\s*===\s*args\.fileId/.test(source) &&
    /linkPreview\?\.screenshotStorageId\s*===\s*args\.fileId/.test(source);

  expect(requiresCardId).toBe(true);
  expect(requiresAuth).toBe(true);
  expect(checksOwnership).toBe(true);
  expect(checksFileMatch).toBe(true);
});
