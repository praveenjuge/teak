import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GET_FILE_URL_REGEX = /getFileUrl/;
const FILE_URL_REGEX = /card\.fileUrl/;

test("CardItem uses pre-resolved fileUrl from cards query", () => {
  const filePath = join(
    (import.meta as any).dir,
    "../../../mobile/components/CardItem.tsx"
  );
  const source = readFileSync(filePath, "utf8");

  // Ensure we no longer call getFileUrl in CardItem.
  const usesGetFileUrl = GET_FILE_URL_REGEX.test(source);
  expect(usesGetFileUrl).toBe(false);

  // Ensure we read the pre-resolved fileUrl field instead.
  const usesFileUrl = FILE_URL_REGEX.test(source);
  expect(usesFileUrl).toBe(true);
});

test("CardItem defers favicon loading and caches failed hosts", () => {
  const filePath = join(
    (import.meta as any).dir,
    "../../../mobile/components/CardItem.tsx"
  );
  const source = readFileSync(filePath, "utf8");

  expect(source).toContain("const FAVICON_RENDER_DELAY_MS = 250");
  expect(source).toContain("const failedFaviconHosts = new Set<string>()");
  expect(source).toContain("setTimeout(() =>");
  expect(source).toContain("failedFaviconHosts.add(hostname)");
});
