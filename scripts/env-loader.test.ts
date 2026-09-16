import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTargetEnv,
  parseDotenvContent,
  parseDotenvValue,
} from "./env-loader.ts";

describe("env-loader", () => {
  test("parser handles quotes, comments, blanks, and CRLF", () => {
    const parsed = parseDotenvContent(
      "# comment\r\nEMPTY=\r\nPLAIN=abc\r\nSINGLE='a b'\r\nDOUBLE=\"c d\"\r\n"
    );
    expect(parsed.values.get("PLAIN")).toBe("abc");
    expect(parsed.values.get("SINGLE")).toBe("a b");
    expect(parsed.values.get("DOUBLE")).toBe("c d");
    expect(parsed.values.get("EMPTY")).toBe("");
    expect(parsed.names).toContain("PLAIN");
  });

  test("parser is first-wins and trims keys", () => {
    expect(parseDotenvValue("A=first\nA=second\n", "A")).toBe("first");
    expect(parseDotenvValue("  B =x\n", "B")).toBe("x");
    expect(parseDotenvValue("A=1\n", "MISSING")).toBeUndefined();
  });

  test("loadTargetEnv reads only declared files", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-loader-"));
    mkdirSync(join(root, "apps/web"), { recursive: true });
    writeFileSync(
      join(root, "apps/web/.env.local"),
      "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\n"
    );
    writeFileSync(join(root, ".env.local"), "POISON=should-not-load\n");
    const loaded = loadTargetEnv("web", "local", root);
    expect(loaded.values.get("NEXT_PUBLIC_CONVEX_URL")).toBe(
      "http://127.0.0.1:3210"
    );
    expect(loaded.values.has("POISON")).toBe(false);
    expect(loaded.files.map((file) => file.path)).toEqual([
      "apps/web/.env.local",
    ]);
  });

  test("loadTargetEnv reports missing files without values", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-loader-"));
    const loaded = loadTargetEnv("desktop", "local", root);
    expect(loaded.files).toEqual([
      { path: "apps/desktop/.env.local", exists: false, names: [] },
    ]);
    expect(loaded.values.size).toBe(0);
  });
});
