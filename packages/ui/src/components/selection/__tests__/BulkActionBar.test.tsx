import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../BulkActionBar.tsx"),
  "utf8"
);

describe("BulkActionBar", () => {
  test("shows singular and plural selection copy", () => {
    expect(source).toContain(
      '{selectedCount} card{selectedCount !== 1 ? "s" : ""} selected'
    );
  });

  test("disables delete when nothing is selected", () => {
    expect(source).toContain("disabled={selectedCount === 0}");
    expect(source).toContain("onClick={onDelete}");
    expect(source).toContain("onClick={onCancel}");
    expect(source).toContain("Delete");
    expect(source).toContain("Cancel");
  });
});
