// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop search wiring", () => {
  it("uses shared search, card actions, modal filters, and drag-drop wiring", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../pages/CardsPage.tsx"),
      "utf8"
    );

    expect(source).toContain("useCardsSearchController");
    expect(source).toContain("useCardActions");
    expect(source).toContain("useCardModalFilterActions");
    expect(source).toContain("useGlobalDragDrop");
    expect(source).toContain("onCopyImage={handleCopyImage}");
    expect(source).toContain("onCardTypeClick={handleCardTypeClick}");
    expect(source).toContain("onTagClick={handleTagClick}");
    expect(source).toContain("CardsSearchHeader");
    expect(source).toContain('navigate("/settings")');
  });
});
