// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as module from "../schema";

describe("schema.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });

  test("defines only the canonical native auth table", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../schema.ts"),
      "utf8"
    );

    expect(source).toContain("nativeAuthCodeValidator");
    expect(source).toContain("nativeAuthCodes: defineTable");
    expect(source).toContain("surface: nativeAuthSurfaceValidator");
    expect(source).toContain('"safari-macos"');
    expect(source).toContain('"safari-ios"');
    expect(source).toContain('"safari-ipados"');
  });
});
