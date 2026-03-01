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
const rootLayoutPath = join(
  (import.meta as any).dir,
  "../../../mobile/app/_layout.tsx"
);
const addTextPath = join(
  (import.meta as any).dir,
  "../../../mobile/app/(tabs)/add/text.tsx"
);
const addRecordPath = join(
  (import.meta as any).dir,
  "../../../mobile/app/(tabs)/add/record.tsx"
);
const addUploadPath = join(
  (import.meta as any).dir,
  "../../../mobile/components/add/upload-file-actions-section.tsx"
);

test("home cards list keeps native refresh and link navigation without swipe delete", () => {
  const source = readFileSync(cardsGridPath, "utf8");

  expect(source).toContain("refreshable(onRefresh)");
  expect(source).toContain("<List.ForEach>");
  expect(source.includes("onDelete={handleDeleteBySwipe}")).toBe(false);
  expect(source).toContain("<Link");
  expect(source).toContain("asChild");
  expect(source.includes("router.push(")).toBe(false);
});

test("home cards list uses paginated query with 20-item first page and explicit load more", () => {
  const source = readFileSync(cardsGridPath, "utf8");

  expect(source).toContain("usePaginatedQuery(");
  expect(source).toContain("api.cards.searchCardsPaginated");
  expect(source).toContain("const PAGE_SIZE = 20");
  expect(source).toContain("initialNumItems: PAGE_SIZE");
  expect(source).toContain(">Load more<");
});

test("settings keeps native labeled rows and segmented appearance picker", () => {
  const source = readFileSync(settingsPath, "utf8");

  expect(source).toContain("<LabeledContent");
  expect(source).toContain('label="Email"');
  expect(source).toContain('label="Usage"');
  expect(source).toContain("<Picker");
  expect(source).toContain('pickerStyle("segmented")');
});

test("root layout wires save feedback as form sheet route", () => {
  const source = readFileSync(rootLayoutPath, "utf8");

  expect(source.includes('name="feedback/save-status"')).toBe(false);
  expect(source.includes("FeedbackSheetCoordinator")).toBe(false);
  expect(source).toContain(
    "const { isLoaded, resolvedScheme } = useThemePreference()"
  );
  expect(source).toContain("if (!isLoaded)");
  expect(source).toContain("requestAnimationFrame(() =>");
  expect(source).not.toContain("if (!isLoading) {\n      hideSplashScreen();");
});

test("add flows no longer use save feedback sheet helpers", () => {
  const textSource = readFileSync(addTextPath, "utf8");
  const recordSource = readFileSync(addRecordPath, "utf8");
  const uploadSource = readFileSync(addUploadPath, "utf8");

  expect(textSource.includes("showSavedFeedback")).toBe(false);
  expect(textSource.includes("showSavingFeedback")).toBe(false);
  expect(textSource.includes("showFailedFeedback")).toBe(false);

  expect(recordSource.includes("showSavedFeedback")).toBe(false);
  expect(recordSource.includes("showSavingFeedback")).toBe(false);
  expect(recordSource.includes("showFailedFeedback")).toBe(false);

  expect(uploadSource.includes("showSavedFeedback")).toBe(false);
  expect(uploadSource.includes("showSavingFeedback")).toBe(false);
  expect(uploadSource.includes("showFailedFeedback")).toBe(false);
});
