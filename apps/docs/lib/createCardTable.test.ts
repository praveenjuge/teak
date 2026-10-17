import { describe, expect, test } from "bun:test";
import path from "node:path";
import { CARD_TYPES } from "@teak/convex/sdk";
import { extractTypeTable } from "blume/components/content/auto-type-table.ts";

const docsRoot = path.join(import.meta.dir, "..");

// The API guide renders this table with
// <AutoTypeTable path="types/create-card.ts" name="CreateCardBody" />.
const createCardRows = () =>
  extractTypeTable({
    name: "CreateCardBody",
    path: "types/create-card.ts",
    root: docsRoot,
  });

describe("API guide create-card table", () => {
  test("lists the SDK's create fields except the upload ones", async () => {
    const names = (await createCardRows()).map((row) => row.name).sort();
    expect(names).toEqual([
      "cardType",
      "content",
      "notes",
      "source",
      "sourceTitle",
      "sourceUrl",
      "tags",
      "url",
    ]);
  });

  test("describes every field it lists", async () => {
    const undescribed = (await createCardRows())
      .filter((row) => !row.description)
      .map((row) => row.name);
    expect(undescribed).toEqual([]);
  });

  test("names every card type in the cardType description", async () => {
    const cardType = (await createCardRows()).find(
      (row) => row.name === "cardType"
    );
    for (const type of CARD_TYPES) {
      expect(cardType?.description).toContain(`\`${type}\``);
    }
    expect(cardType?.default).toBe("inferred");
  });
});
