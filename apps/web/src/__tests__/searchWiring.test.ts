// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("web search wiring", () => {
  it("uses the shared cards screen adapter", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/HomePageClient.tsx"),
      "utf8"
    );

    expect(source).toContain("CardsScreenAdapter");
    expect(source).toContain("cardIdFromUrl={cardIdFromUrl}");
    expect(source).toContain("pushCardId");
    expect(source).toContain("replaceCardId");
    expect(source).toContain("SettingsButton={settingsButton}");
    expect(source).not.toContain("useCardQueryParamState");
  });
});
