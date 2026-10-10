import { describe, expect, test } from "bun:test";
import { mainWorktreePorts } from "../worktree-env.ts";
import { isProcessAlive, isStackRunning, type StackState } from "./stack-state.ts";

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
