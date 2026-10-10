import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConvexDotenvUrls } from "./setup-convex.ts";

describe("readConvexDotenvUrls", () => {
  test("reads convex dotenv urls without requiring them", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const dotenv = join(dir, ".env.local");
    writeFileSync(
      dotenv,
      "CONVEX_DEPLOYMENT=dev:x\nNEXT_PUBLIC_CONVEX_URL=https://c.example\n"
    );
    expect(readConvexDotenvUrls(dotenv)).toEqual({
      convexUrl: "https://c.example",
    });
    expect(readConvexDotenvUrls(join(dir, "absent"))).toEqual({});
  });
});
