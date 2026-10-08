import { describe, expect, test } from "bun:test";
import { runCommand } from "./proc.ts";

const groupGone = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch {
    return true;
  }
};

describe("runCommand", () => {
  test("captures stdout and exit code", async () => {
    const result = await runCommand(["echo", "hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  test("passes stdin to the child instead of argv", async () => {
    const result = await runCommand(["cat"], { stdin: "piped-value" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("piped-value");
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
    let gone = groupGone(result.pid);
    for (let i = 0; i < 30 && !gone; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      gone = groupGone(result.pid);
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

  // The Convex CLI exits while its local backend may still hold port 3210;
  // the next command must not find that backend running.
  test("a normal exit stops descendants the command left running", async () => {
    const result = await runCommand([
      "sh",
      "-c",
      "sleep 31 > /dev/null 2>&1 & echo started",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("started");
    expect(groupGone(result.pid)).toBe(true);
  });

  test("a normal exit kills descendants that ignore SIGTERM", async () => {
    const started = Date.now();
    const result = await runCommand([
      "sh",
      "-c",
      "(trap '' TERM; exec sleep 32) > /dev/null 2>&1 & exit 0",
    ]);
    expect(result.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    // SIGKILL ends it at once; init may take a moment to reap the zombie.
    let gone = groupGone(result.pid);
    for (let i = 0; i < 30 && !gone; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      gone = groupGone(result.pid);
    }
    expect(gone).toBe(true);
  }, 15_000);
});
