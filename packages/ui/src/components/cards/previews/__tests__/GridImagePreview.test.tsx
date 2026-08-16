import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../GridImagePreview.tsx"),
  "utf8"
);

describe("GridImagePreview", () => {
  test("fills the card box exactly and covers when the aspect ratio is known", () => {
    expect(source).toContain('className="relative aspect-[4/3] w-full overflow-hidden');
    expect(source).toContain("objectFit: hasKnownRatio ? \"cover\"");
    expect(source).toContain("position: \"absolute\"");
    expect(source).toContain('height: "100%"');
    expect(source).toContain('width: "100%"');
  });

  test("falls back to contain so unknown-ratio images are never cropped", () => {
    expect(source).toContain('objectFit: hasKnownRatio ? "cover" : "contain"');
    expect(source).toContain("aspect-[4/3]");
  });
});
