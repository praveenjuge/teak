import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("CardItem uses pre-resolved fileUrl from cards query", () => {
  const filePath = join((import.meta as any).dir, "../../../mobile/components/CardItem.tsx");
  const source = readFileSync(filePath, "utf8");

  // Ensure we no longer call getFileUrl in CardItem.
  const usesGetFileUrl = /getFileUrl/.test(source);
  expect(usesGetFileUrl).toBe(false);

  // Ensure we read the pre-resolved fileUrl field instead.
  const usesFileUrl = /card\.fileUrl/.test(source);
  expect(usesFileUrl).toBe(true);
});
