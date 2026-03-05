// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop search wiring", () => {
  it("uses shared cards screen and shared query-param state", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../pages/CardsPage.tsx"),
      "utf8"
    );

    expect(source).toContain("CardsScreen");
    expect(source).toContain("useCardQueryParamState");
    expect(source).toContain("useGlobalDragDrop");
    expect(source).toContain("SettingsButton={settingsButton}");
    expect(source).toContain('navigate("/settings")');
  });
});
