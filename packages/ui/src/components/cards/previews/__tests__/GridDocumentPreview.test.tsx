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

  test("lazy-loads the thumbnail inside the reserved box by default", () => {
    expect(source).toContain('loading={isPriority ? "eager" : "lazy"}');
    expect(source).toContain('className="relative w-full overflow-hidden"');
  });

  test("prioritizes above-the-fold thumbnails", () => {
    expect(source).toContain('fetchPriority={isPriority ? "high" : undefined}');
    expect(source).toContain('decoding="async"');
  });
});
