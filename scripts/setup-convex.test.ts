import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConvexDotenvUrls, summarizePushFailure } from "./setup-convex.ts";

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

describe("summarizePushFailure", () => {
  test("keeps the signal line even when it precedes the tail", () => {
    const stderr = [
      "Environment variable JWKS is used in auth config file but its value was not set.",
      "Go to:",
      "",
      "    https://dashboard.convex.dev/d/acme/settings/environment-variables?var=JWKS",
      "",
      "  to set it up.",
    ].join("\n");
    const summary = summarizePushFailure(stderr);
    expect(summary).toContain("Environment variable JWKS");
    expect(summary).toContain("to set it up.");
  });

  test("falls back to the tail when nothing matches", () => {
    expect(summarizePushFailure("a\nb\nc\nd")).toBe("b c d");
  });

  test("reports unknown error for blank output", () => {
    expect(summarizePushFailure("  \n ")).toBe("unknown error");
  });
});
