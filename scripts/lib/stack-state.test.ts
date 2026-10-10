import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainWorktreePorts } from "../worktree-env.ts";
import {
  isProcessAlive,
  isStackRunning,
  readStackState,
  type StackState,
} from "./stack-state.ts";

const state = (pid: number): StackState => ({
  groups: [pid],
  logPath: "/tmp/stack.log",
  mode: "dev",
  pid,
  ports: mainWorktreePorts(),
  ready: true,
  startedAt: "2026-10-09T00:00:00.000Z",
  urls: {
    appOrigin: "http://localhost:3000",
    convexUrl: "https://dev-example.convex.cloud",
    apiOrigin: "https://dev-example.convex.site",
  },
});

describe("stack liveness", () => {
  test("rejects PIDs that would signal a group or init", () => {
    for (const pid of [0, 1, -5, 1.5, Number.NaN]) {
      expect(isProcessAlive(pid)).toBe(false);
    }
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("a live process that isn't a stack owner is not a running stack", () => {
    // This test runner is alive but isn't scripts/dev.ts, like a PID reused
    // after a reboot.
    expect(isStackRunning(state(process.pid))).toBe(false);
  });
});

describe("readStackState", () => {
  const rootWith = (content: string) => {
    const root = mkdtempSync(join(tmpdir(), "teak-stack-state-"));
    mkdirSync(join(root, ".agents/.state"), { recursive: true });
    writeFileSync(join(root, ".agents/.state/stack.json"), content);
    return root;
  };

  test("treats a file that isn't a stack's state as no state", () => {
    for (const content of ["{}", "[]", "42", "null", "not json", '{"pid":1}']) {
      expect(readStackState(rootWith(content))).toBeNull();
    }
  });

  test("reads a recorded stack", () => {
    const root = rootWith(JSON.stringify(state(4242)));
    expect(readStackState(root)?.urls.appOrigin).toBe("http://localhost:3000");
  });
});
