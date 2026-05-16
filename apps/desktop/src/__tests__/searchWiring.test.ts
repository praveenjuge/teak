// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop search wiring", () => {
  it("uses the shared cards screen adapter", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../pages/CardsPage.tsx"),
      "utf8"
    );

    expect(source).toContain("CardsScreenAdapter");
    expect(source).toContain("cardIdFromUrl={cardId}");
    expect(source).toContain("pushCardId={setCardId}");
    expect(source).toContain("replaceCardId={setCardId}");
    expect(source).toContain("SettingsButton={settingsButton}");
    expect(source).toContain("onNavigateToSettings");
    expect(source).not.toContain("useCardQueryParamState");
    // Drag/drop is owned by the authenticated shell, not the cards page.
    expect(source).not.toContain("useGlobalDragDrop");
    expect(source).not.toContain("isDragActive");
  });

  it("mounts the shared drop provider only for authenticated users", () => {
    const source = readFileSync(resolve(import.meta.dir, "../App.tsx"), "utf8");

    expect(source).toContain("GlobalFileDropProvider");
    // Provider must wrap the authenticated branches (cards / settings) but
    // never the login screen.
    const providerIndex = source.indexOf("<GlobalFileDropProvider");
    const loginIndex = source.indexOf("<LoginPage");
    expect(providerIndex).toBeGreaterThan(-1);
    expect(loginIndex).toBeGreaterThan(-1);
    expect(loginIndex).toBeLessThan(providerIndex);
  });
});
