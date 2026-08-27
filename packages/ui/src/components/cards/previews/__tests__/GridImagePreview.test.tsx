import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../GridImagePreview.tsx"),
  "utf8"
);

describe("GridImagePreview", () => {
  test("lazy-loads by default and reserves aspect ratio", () => {
    expect(source).toContain('loading={isPriority ? "eager" : "lazy"}');
    expect(source).toContain("aspectRatio:");
  });

  test("prioritizes above-the-fold images", () => {
    expect(source).toContain('fetchPriority={isPriority ? "high" : undefined}');
    expect(source).toContain('decoding="async"');
  });

  test("uses responsive renditions without a second placeholder request", () => {
    expect(source).toContain("srcSet=");
    expect(source).toContain('sizes="(max-width: 640px) 50vw');
    expect(source).not.toContain("placeholderUrl");
    expect(source).toContain("ResilientMediaImage");
  });
});
