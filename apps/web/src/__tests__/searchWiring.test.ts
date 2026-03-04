// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("web search wiring", () => {
  it("uses shared search controller and shared header", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/page.tsx"),
      "utf8"
    );

    expect(source).toContain("useCardsSearchController");
    expect(source).toContain("CardsSearchHeader");
    expect(source).toContain("SettingsButton={settingsButton}");
  });
});
