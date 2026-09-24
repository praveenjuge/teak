import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const testDir = (import.meta as any).dir as string;
const readSource = (relativePath: string) =>
  readFileSync(join(testDir, relativePath), "utf8");

const sheetPath = "../../../mobile/components/CardPreviewSheet.tsx";
const sheetDir = "../../../mobile/components/card-sheet";
const actionsPath = `${sheetDir}/ActionsSection.tsx`;

const readSheetSources = () =>
  [
    readSource(sheetPath),
    ...readdirSync(join(testDir, sheetDir))
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readSource(`${sheetDir}/${file}`)),
  ].join("\n");

test("card sheet renders one grouped list with native sections", () => {
  const source = readSource(sheetPath);

  expect(source).toContain('listStyle("insetGrouped")');
  expect(source).toContain("<Section");
  expect(source).not.toContain('listStyle("plain")');
  expect(source).not.toContain("borderedProminent");
});

test("card sheet keeps every text element in the rounded design", () => {
  const source = readSheetSources();

  expect(source).toContain('design: "rounded"');
  expect(source).not.toContain('design: "serif"');
  expect(source).not.toContain("Alert.alert");
  expect(source).not.toContain("expo-sharing");
  expect(readSource(sheetPath)).not.toContain('from "react-native"');
});

test("card sheet actions stay fully native without RN alerts", () => {
  const source = readSource(actionsPath);

  expect(source).toContain("ShareLink");
  expect(source).toContain("ConfirmationDialog");
  expect(source).toContain('field: "isFavorited"');
  expect(source).toContain('field: "delete"');
  expect(source).not.toContain("Alert.alert");
  expect(source).not.toContain("expo-sharing");
});
