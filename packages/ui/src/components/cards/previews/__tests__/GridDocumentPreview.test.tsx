import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../GridDocumentPreview.tsx"),
  "utf8"
);

describe("GridDocumentPreview", () => {
  test("reserves aspect ratio from width/height with a portrait fallback", () => {
    expect(source).toContain(
      "width && height ? width / height : FALLBACK_ASPECT_RATIO"
    );
    expect(source).toContain("aspectRatio:");
  });

  test("contains the lazy-loaded thumbnail inside the reserved box", () => {
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('className="relative w-full overflow-hidden"');
  });
});
