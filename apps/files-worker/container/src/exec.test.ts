import { describe, expect, test } from "bun:test";
import type { ToolCommand } from "./args";
import { ADDRESS_SPACE_BYTES, limitedCommand, run } from "./exec";

const shell = (script: string) =>
  ["sh", "-c", script] as unknown as ToolCommand;

describe("limitedCommand", () => {
  test("wraps the command in prlimit on Linux", () => {
    expect(limitedCommand(["ffmpeg", "-i", "x"], 59.2, "linux")).toEqual([
      "prlimit",
      `--as=${ADDRESS_SPACE_BYTES}`,
      "--cpu=60",
      "--nofile=64",
      "--core=0",
      "--",
      "ffmpeg",
      "-i",
      "x",
    ]);
    expect(ADDRESS_SPACE_BYTES).toBe(1024 * 1024 * 1024);
  });

  test("never sets a CPU limit below one second", () => {
    expect(limitedCommand(["true"], 0.01, "linux")).toContain("--cpu=1");
  });

  test("runs the command directly elsewhere", () => {
    expect(limitedCommand(["ffmpeg"], 10, "darwin")).toEqual(["ffmpeg"]);
  });
});

describe("run", () => {
  test("captures exit code, stdout and stderr", async () => {
    const result = await run(shell("printf out; printf err >&2; exit 3"), {
      deadlineEpochMs: Date.now() + 5000,
    });
    expect(result.exitCode).toBe(3);
    expect(new TextDecoder().decode(result.stdout)).toBe("out");
    expect(result.stderr).toBe("err");
    expect(result.timedOut).toBe(false);
  });

  test("kills the whole process group at the deadline", async () => {
    const started = Date.now();
    const result = await run(shell("sleep 30 & sleep 30"), {
      deadlineEpochMs: Date.now() + 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("does not start a process once the deadline has passed", async () => {
    const result = await run(shell("exit 0"), {
      deadlineEpochMs: Date.now() - 1,
    });
    expect(result.timedOut).toBe(true);
  });

  test("keeps only the first maxStdoutBytes of output", async () => {
    const result = await run(shell("printf 0123456789"), {
      deadlineEpochMs: Date.now() + 5000,
      stdout: { kind: "buffer", maxBytes: 4, stopAtLimit: false },
    });
    expect(new TextDecoder().decode(result.stdout)).toBe("0123");
    expect(result.stdoutTruncated).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("stops an endless writer once its output is full", async () => {
    const started = Date.now();
    const result = await run(shell("yes"), {
      deadlineEpochMs: Date.now() + 10_000,
      stdout: { kind: "buffer", maxBytes: 1024, stopAtLimit: true },
    });
    expect(result.stdout.byteLength).toBe(1024);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("streams stdout to a callback instead of buffering it", async () => {
    let total = 0;
    const result = await run(shell("head -c 100000 /dev/zero"), {
      deadlineEpochMs: Date.now() + 5000,
      stdout: {
        kind: "stream",
        onChunk: (chunk) => {
          total += chunk.byteLength;
        },
      },
    });
    expect(total).toBe(100_000);
    expect(result.stdout.byteLength).toBe(0);
  });
});
