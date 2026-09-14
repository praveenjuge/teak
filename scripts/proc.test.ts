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

  test("timeout terminates descendant processes with the tree", async () => {
    const result = await runCommand(["sh", "-c", "sleep 30 & wait"], {
      timeoutMs: 2000,
    });
    expect(result.timedOut).toBe(true);
    const groupGone = (): boolean => {
      try {
        process.kill(-result.pid, 0);
        return false;
      } catch {
        return true;
      }
    };
    let gone = groupGone();
    for (let i = 0; i < 30 && !gone; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      gone = groupGone();
    }
    expect(gone).toBe(true);
    // pgrep independently proves the sleeper itself is gone. Restricted
    // sandboxes cannot list processes (pgrep exits 3); there this half is
    // skipped and the signal-zero check above still applies.
    const probe = await runCommand(["pgrep", "-f", "sleep 30$"], {
      timeoutMs: 5000,
    });
    if (probe.exitCode === 0 || probe.exitCode === 1) {
      expect(probe.stdout.trim()).toBe("");
    } else {
      console.warn(
        `pgrep descendant check skipped (exit ${probe.exitCode}); sandbox cannot list processes`
      );
    }
  });
});
