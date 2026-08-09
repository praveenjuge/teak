import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GET_FILE_URL_REGEX = /getFileUrl/;
const FILE_URL_REGEX = /card\.fileUrl/;

test("CardItem loads full card data only for file actions", () => {
  const filePath = join(
    (import.meta as any).dir,
    "../../../mobile/components/CardItem.tsx"
  );
  const source = readFileSync(filePath, "utf8");

  const usesGetFileUrl = GET_FILE_URL_REGEX.test(source);
  expect(usesGetFileUrl).toBe(false);
  expect(FILE_URL_REGEX.test(source)).toBe(false);
  expect(source).toContain("api.cards.getCard");
  expect(source).toContain("handleDownloadCard");
  expect(source).toContain("handleShareCardFile");
});

test("CardItem caches thumbnails and favicons without per-row timers", () => {
  const filePath = join(
    (import.meta as any).dir,
    "../../../mobile/components/CardItem.tsx"
  );
  const source = readFileSync(filePath, "utf8");

  expect(source).toContain("const failedFaviconHosts = new Set<string>()");
  expect(source).not.toContain("setTimeout(() =>");
  expect(source).toContain("failedFaviconHosts.add(hostname)");
  expect(source).toContain('cachePolicy="memory-disk"');
  expect(source).toContain("enforceEarlyResizing");
});

test("CardItem exposes download and share actions for file-card types", () => {
  const filePath = join(
    (import.meta as any).dir,
    "../../../mobile/components/CardItem.tsx"
  );
  const source = readFileSync(filePath, "utf8");

  for (const cardType of ["document", "audio", "image", "video"]) {
    expect(source).toContain(`case "${cardType}"`);
  }
  expect(source).toContain("handleDownloadCard(");
  expect(source).toContain("handleShareFromUrl(");
  expect(source).toContain("getNativeShareOptions(");
});
