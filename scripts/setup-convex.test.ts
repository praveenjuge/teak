import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommandResult } from "./proc.ts";
import {
  convexDevOnce,
  isTransientPushFailure,
  readConvexDotenvUrls,
  summarizePushFailure,
} from "./setup-convex.ts";

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

describe("isTransientPushFailure", () => {
  test("matches the local backend journal race from CI", () => {
    expect(
      isTransientPushFailure(
        "Unexpected Error: Error: ENOENT: no such file or directory, stat '/home/runner/work/teak/teak/packages/convex/.convex/local/default/convex_local_backend.sqlite3-journal'"
      )
    ).toBe(true);
  });

  test("matches other local backend startup races", () => {
    expect(
      isTransientPushFailure("Error: SQLITE_BUSY: database is locked")
    ).toBe(true);
    expect(
      isTransientPushFailure("Error: connect ECONNREFUSED 127.0.0.1:3210")
    ).toBe(true);
  });

  test("rejects deterministic configuration failures", () => {
    expect(
      isTransientPushFailure(
        "Failed to analyze auth.js: Uncaught Error: SITE_URL environment variable is required."
      )
    ).toBe(false);
    expect(
      isTransientPushFailure(
        "Environment variable JWKS is used in auth config file but its value was not set."
      )
    ).toBe(false);
    expect(isTransientPushFailure("")).toBe(false);
  });

  test("rejects deterministic database errors naming the backend file", () => {
    expect(
      isTransientPushFailure(
        "Error: convex_local_backend.sqlite3 database disk image is malformed"
      )
    ).toBe(false);
  });
});

describe("convexDevOnce retry", () => {
  const JOURNAL_STDERR =
    "Unexpected Error: Error: ENOENT: no such file or directory, stat '/home/runner/work/teak/teak/packages/convex/.convex/local/default/convex_local_backend.sqlite3-journal'";
  const SITE_URL_STDERR =
    "Failed to analyze auth.js: Uncaught Error: SITE_URL environment variable is required.";

  interface ScriptedResult {
    exitCode: number;
    stderr: string;
    stdout?: string;
  }

  const makeRunner = (script: ScriptedResult[]) => {
    const calls: string[][] = [];
    const run = (command: string[]): Promise<RunCommandResult> => {
      calls.push(command);
      const next = script[Math.min(calls.length - 1, script.length - 1)];
      return Promise.resolve({
        exitCode: next.exitCode,
        pid: 1,
        stderr: next.stderr,
        stdout: next.stdout ?? "",
        timedOut: false,
      });
    };
    return { calls, run };
  };

  test("retries a transient journal failure until the push succeeds", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: JOURNAL_STDERR },
      { exitCode: 0, stderr: "" },
    ]);
    const sleeps: number[] = [];
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ detail: "pushed", ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["bunx", "convex", "dev", "--once"]);
    expect(sleeps).toHaveLength(1);
  });

  test("gives up after exhausting attempts on persistent transient failures", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: JOURNAL_STDERR },
    ]);
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("ENOENT");
    expect(calls).toHaveLength(3);
  });

  test("does not retry deterministic failures", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: SITE_URL_STDERR },
    ]);
    const sleeps: number[] = [];
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SITE_URL");
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  test("honors a single attempt even for transient failures", async () => {
    const { calls, run } = makeRunner([
      { exitCode: 1, stderr: JOURNAL_STDERR },
    ]);
    const result = await convexDevOnce("/tmp/teak-convex", {
      attempts: 1,
      run,
      sleepMs: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("falls back to the default attempts for nonfinite values", async () => {
    for (const attempts of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { calls, run } = makeRunner([
        { exitCode: 1, stderr: JOURNAL_STDERR },
      ]);
      const result = await convexDevOnce("/tmp/teak-convex", {
        attempts,
        run,
        sleepMs: () => Promise.resolve(),
      });
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(3);
    }
  });

  test("preserves transient diagnostics that appear only in stdout", async () => {
    const { calls, run } = makeRunner([
      {
        exitCode: 1,
        stderr: "",
        stdout: "Error: SQLITE_BUSY: database is locked",
      },
    ]);
    const result = await convexDevOnce("/tmp/teak-convex", {
      run,
      sleepMs: () => Promise.resolve(),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("SQLITE_BUSY");
    expect(calls).toHaveLength(3);
  });
});
