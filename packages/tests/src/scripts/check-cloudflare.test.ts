import { describe, expect, test } from "bun:test";
import { parseConvexEnvOutput } from "../../../../scripts/check-cloudflare";
import { mergeDotenvValue } from "../../../../scripts/sync-files-worker-dev-secret";

describe("Cloudflare parity output parsing", () => {
  test("reads a normal newline-terminated Convex value", () => {
    expect(parseConvexEnvOutput("secret-value\n", "", 0)).toEqual({
      status: "found",
      value: "secret-value",
    });
  });

  test("recognizes a missing deployment variable", () => {
    expect(
      parseConvexEnvOutput(
        "",
        'Environment variable "R2_KEY_PREFIX" not found (on prod deployment)',
        0
      )
    ).toEqual({ status: "missing" });
  });

  test("does not misreport CLI failures as missing variables", () => {
    expect(parseConvexEnvOutput("", "No CONVEX_DEPLOYMENT set", 1)).toEqual({
      status: "unavailable",
      reason: "command_failed",
    });
  });

  test("keeps missing status when Convex exits non-zero", () => {
    expect(
      parseConvexEnvOutput(
        "",
        'Environment variable "R2_KEY_PREFIX" not found (on prod deployment)',
        1
      )
    ).toEqual({ status: "missing" });
  });

  test("updates the signing secret without dropping other local vars", () => {
    expect(
      mergeDotenvValue(
        "SENTRY_DSN=https://example.test/1\nFILES_SIGNING_SECRET=old\n",
        "FILES_SIGNING_SECRET",
        "new"
      )
    ).toBe("SENTRY_DSN=https://example.test/1\nFILES_SIGNING_SECRET=new\n");
  });
});
