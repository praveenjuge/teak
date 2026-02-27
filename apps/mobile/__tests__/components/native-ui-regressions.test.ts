import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cardsGridPath = join(
  (import.meta as any).dir,
  "../../../mobile/components/CardsGrid.tsx"
);
const settingsPath = join(
  (import.meta as any).dir,
  "../../../mobile/app/(tabs)/settings/index.tsx"
);

test("home cards list keeps native refresh, swipe delete, and link navigation", () => {
  const source = readFileSync(cardsGridPath, "utf8");

  expect(source).toContain("refreshable(handleRefresh)");
  expect(source).toContain("<List.ForEach onDelete={handleDeleteBySwipe}>");
  expect(source).toContain("<Link");
  expect(source).toContain("asChild");
  expect(source.includes("router.push(")).toBe(false);
});

test("settings keeps native labeled rows and segmented appearance picker", () => {
  const source = readFileSync(settingsPath, "utf8");

  expect(source).toContain('<LabeledContent label="Email">');
  expect(source).toContain('<LabeledContent label="Usage">');
  expect(source).toContain("<Picker");
  expect(source).toContain('pickerStyle("segmented")');
});
