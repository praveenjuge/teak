import { describe, expect, test } from "bun:test";
import {
  isProcessAlive,
  isStackRunning,
  MAIN_STACK_PORTS,
  type StackState,
  stackUrls,
} from "./config";

const state = (pid: number): StackState => ({
  groups: [pid],
  logPath: "/tmp/stack.log",
  mode: "e2e",
  pid,
  ports: MAIN_STACK_PORTS,
  ready: true,
  startedAt: "2026-10-09T00:00:00.000Z",
  urls: stackUrls(MAIN_STACK_PORTS),
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
