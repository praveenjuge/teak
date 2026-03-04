// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop search wiring", () => {
  it("uses shared search controller/header and local settings route", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../pages/CardsPage.tsx"),
      "utf8"
    );

    expect(source).toContain("useCardsSearchController");
    expect(source).toContain("CardsSearchHeader");
    expect(source).toContain("navigate(\"/settings\")");
  });
});
