import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainWorktreePorts } from "../worktree-env.ts";
import {
  isProcessAlive,
  isStackRunning,
  readStackState,
  recordStartingStack,
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
    expect(isStackRunning(state(process.pid))).toBe(false);
  });

  test("bun run dev's stack runs as scripts/dev-main.ts", () => {
    const owner = Bun.spawn([
      "sh",
      "-c",
      "sleep 30; :",
      "/repo/scripts/dev-main.ts",
    ]);
    try {
      expect(isStackRunning(state(owner.pid))).toBe(true);
    } finally {
      owner.kill("SIGKILL");
    }
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

describe("recordStartingStack", () => {
  const { ready: _ready, startedAt: _startedAt, ...fields } = state(4242);

  test("records a stack that is still starting, so it can be found and stopped", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-stack-state-"));
    recordStartingStack(root, fields);
    expect(readStackState(root)).toMatchObject({
      groups: [4242],
      ready: false,
    });
  });

  test("saves later changes to the same record", () => {
    const root = mkdtempSync(join(tmpdir(), "teak-stack-state-"));
    const { save, state: recorded } = recordStartingStack(root, fields);
    recorded.ready = true;
    save();
    expect(readStackState(root)?.ready).toBe(true);
  });
});
