import { describe, expect, test } from "bun:test";
import { runCommand } from "./proc.ts";

describe("runCommand", () => {
  test("captures stdout and exit code", async () => {
    const result = await runCommand(["echo", "hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  test("reports nonzero exits without throwing", async () => {
    const result = await runCommand(["sh", "-c", "echo oops >&2; exit 3"]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr.trim()).toBe("oops");
    expect(result.timedOut).toBe(false);
  });

  test("timeout resolves instead of hanging on inherited pipes", async () => {
    const started = Date.now();
    const result = await runCommand(["sh", "-c", "sleep 30 & wait"], {
      timeoutMs: 2000,
    });
    expect(Date.now() - started).toBeLessThan(25_000);
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("timed out after 2000ms");
  });
});
