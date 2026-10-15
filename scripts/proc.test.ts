import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./proc.ts";

const PROC_MODULE = join(import.meta.dir, "proc.ts");

const signalWhileRunning = async (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "proc-signal-"));
  try {
    const script = join(dir, "script.ts");
    writeFileSync(
      script,
      `import { onExitSignal, runCommand } from ${JSON.stringify(PROC_MODULE)};\n${body}`
    );
    const child = Bun.spawn(["bun", script], { stdout: "pipe" });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("ready")) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      output += decoder.decode(value);
    }
    child.kill("SIGTERM");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      output += decoder.decode(value);
    }
    await child.exited;
    return { exitCode: child.exitCode, output, signalCode: child.signalCode };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

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

  test("a descendant holding the output pipe does not delay a normal exit", async () => {
    const started = Date.now();
    const result = await runCommand(["sh", "-c", "sleep 33 & echo started"], {
      timeoutMs: 20_000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("started");
    expect(Date.now() - started).toBeLessThan(10_000);
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

  test("children see environment changes made after startup", async () => {
    const tmp = process.env.TMPDIR;
    const home = process.env.HOME;
    process.env.TMPDIR = "/set-at-runtime";
    delete process.env.HOME;
    try {
      const result = await runCommand([
        "sh",
        "-c",
        'echo "$TMPDIR"; test -n "$HOME" || echo removed',
      ]);
      expect(result.stdout.trim().split("\n")).toEqual([
        "/set-at-runtime",
        "removed",
      ]);
    } finally {
      if (tmp === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = tmp;
      }
      process.env.HOME = home;
    }
  });

  test("a signal mid-command leaves the script's own shutdown handler to finish", async () => {
    const ended = await signalWhileRunning(`
onExitSignal(async () => {
  await Bun.sleep(300);
  console.log("cleaned up");
  process.exit(0);
});
const running = runCommand(["sleep", "34"]);
console.log("ready");
const result = await running;
console.log(\`sleeper \${result.pid}\`);
await Bun.sleep(5000);
`);
    expect(ended.output).toContain("cleaned up");
    expect(ended.exitCode).toBe(0);
    const sleeper = Number(ended.output.match(/sleeper (\d+)/)?.[1]);
    expect(groupGone(sleeper)).toBe(true);
  }, 15_000);

  test("without a handler of its own, a script still ends by the signal", async () => {
    const ended = await signalWhileRunning(`
const running = Promise.all([
  runCommand(["sleep", "35"]),
  runCommand(["sleep", "36"]),
]);
console.log("ready");
await running;
console.log("kept running");
await Bun.sleep(5000);
`);
    expect(ended.signalCode).toBe("SIGTERM");
    expect(ended.output).not.toContain("kept running");
  }, 15_000);
});
