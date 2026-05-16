// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop native auth wiring", () => {
  test("native auth starts and polls through generic native auth routes", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../lib/native-auth.ts"),
      "utf8"
    );

    expect(source).toContain('buildWebUrl("/native/auth/start")');
    expect(source).toContain('buildWebUrl("/native/auth/complete")');
    expect(source).toContain('url.searchParams.set("surface", "desktop")');
    expect(source).toContain("/api/native/auth/poll");
  });
});
