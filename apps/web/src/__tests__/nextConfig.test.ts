import { describe, expect, test } from "bun:test";
import { nextConfig } from "../../next.config";

describe("Next.js 16.3 web configuration", () => {
  test("enables Cache Components and route-shell prefetching", () => {
    expect(nextConfig.cacheComponents).toBe(true);
    expect(nextConfig.partialPrefetching).toBe(true);
  });

  test("uses the native React compiler and persistent Turbopack build cache", () => {
    expect(nextConfig.reactCompiler).toBe(true);
    expect(nextConfig.experimental?.turbopackRustReactCompiler).toBe(true);
    expect(nextConfig.experimental?.turbopackFileSystemCacheForBuild).toBe(
      true
    );
    expect(
      "turbopackFileSystemCacheForDev" in (nextConfig.experimental ?? {})
    ).toBe(false);
    expect("webpack" in nextConfig).toBe(false);
  });

  test("generates SHA-384 subresource integrity metadata", () => {
    expect(nextConfig.experimental?.sri).toEqual({ algorithm: "sha384" });
  });
});
