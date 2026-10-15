/**
 * The state file a running stack records, and the process helpers that start
 * and stop one. `bun run dev` (scripts/dev-stack.ts) and the E2E suite's stack
 * (packages/tests/src/stack) share them, so each refuses to start on the
 * other's ports and either can be stopped after a crash.
 *
 * The e2e CLI loads this file under Node (packages/tests/src/helpers/env.ts),
 * so it uses only `node:` modules, no Bun APIs.
 */

import { type ChildProcess, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorktreePorts } from "../worktree-env.ts";

export interface StackUrls {
  apiOrigin: string;
  appOrigin: string;
  convexUrl: string;
  emulatorOrigin?: string;
}

export const stackStatePath = (root: string): string =>
  join(root, ".agents/.state/stack.json");

export interface StackState {
  account?: { email: string; password: string };
  groups: number[];
  logPath: string;
  mode: "dev" | "e2e";
  notes?: string[];
  pid: number;
  ports: WorktreePorts;
  pushing?: boolean;
  ready: boolean;
  startedAt: string;
  urls: StackUrls;
}

export const readStackState = (root: string): StackState | null => {
  const path = stackStatePath(root);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isStackState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isStackState = (value: unknown): value is StackState => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const state = value as Partial<StackState>;
  return (
    typeof state.pid === "number" &&
    (state.mode === "dev" || state.mode === "e2e") &&
    typeof state.urls === "object" &&
    state.urls !== null &&
    typeof state.urls.appOrigin === "string"
  );
};

const validPid = (pid: unknown): pid is number =>
  typeof pid === "number" && Number.isInteger(pid) && pid > 1;

// Signal 0 checks existence. Only ESRCH proves the target is gone; EPERM
// means it exists but belongs to someone else.
const exists = (target: number): boolean => {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

export const isProcessAlive = (pid: number): boolean =>
  validPid(pid) && exists(pid);

// Command lines of live processes, so a PID reused after a crash or reboot
// is never mistaken for the stack. Null when `ps` can't run (an image
// without procps), which proves nothing either way.
const commands = ():
  | { command: string; pgid: number; pid: number }[]
  | null => {
  try {
    return execFileSync("ps", ["-axo", "pid=,pgid=,command="], {
      encoding: "utf-8",
    })
      .split("\n")
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return match
          ? [
              {
                pid: Number(match[1]),
                pgid: Number(match[2]),
                command: match[3],
              },
            ]
          : [];
      });
  } catch {
    return null;
  }
};

const STACK_OWNERS = ["scripts/dev.ts", "run-local-suite.ts"];
// Leaves `group`, the single group older stacks recorded, readable.
const groupsOf = (state: StackState & { group?: number }): number[] =>
  state.groups ?? (state.group ? [state.group] : []);
const STACK_MEMBERS = ["convex", "next"];

/**
 * The recorded owner is alive and is still a Teak stack process. Without
 * `ps` only liveness can be checked, so a live PID counts as the stack and
 * its state is never treated as orphaned.
 */
export const isStackRunning = (state: StackState): boolean => {
  if (!isProcessAlive(state.pid)) {
    return false;
  }
  const list = commands();
  return (
    list === null ||
    list.some(
      (entry) =>
        entry.pid === state.pid &&
        STACK_OWNERS.some((owner) => entry.command.includes(owner))
    )
  );
};

// The backend and web app's process group, if any of its members is still a
// Convex or Next.js process. Without `ps` membership can't be proven, and a
// group ID may have been reused, so the group is never signaled.
const groupAlive = (group: number): boolean => {
  if (!(validPid(group) && exists(-group))) {
    return false;
  }
  const list = commands();
  return (
    list?.some(
      (entry) =>
        entry.pgid === group &&
        STACK_MEMBERS.some((member) => entry.command.includes(member))
    ) ?? false
  );
};

const signalGroup = (group: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-group, signal);
  } catch {}
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop a stack whose owner died without cleaning up (killed with SIGKILL, or
 * a crash), so its backend and web server don't hold the ports forever.
 * Returns true when it stopped one.
 */
export const stopOrphanedStack = async (root: string): Promise<boolean> => {
  const state = readStackState(root);
  if (!state || isStackRunning(state)) {
    return false;
  }
  for (const group of groupsOf(state)) {
    if (!groupAlive(group)) {
      continue;
    }
    signalGroup(group, "SIGINT");
    const deadline = Date.now() + 15_000;
    while (groupAlive(group) && Date.now() < deadline) {
      await sleep(200);
    }
    if (groupAlive(group)) {
      signalGroup(group, "SIGKILL");
    }
  }
  rmSync(stackStatePath(root), { force: true });
  return true;
};

export const waitFor = async (
  url: string,
  child: ChildProcess,
  timeoutMs: number
) => {
  const deadline = Date.now() + timeoutMs;
  let refusals = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The stack exited before ${url} came up`);
    }
    try {
      // The web app redirects to sign-in, so follow redirects and require the
      // final page (or the API health check) to succeed. Only the stack's own
      // loopback URLs are polled.
      // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) {
        return;
      }
      // A local backend answers this 404 until its first push lands, which
      // takes longer than the refusal budget on slower machines (cloud VMs).
      const pushing = body.includes("does not have HTTP actions enabled");
      refusals = response.status < 500 && !pushing ? refusals + 1 : 0;
      if (refusals >= 15) {
        throw new Error(
          `${url} keeps answering ${response.status}: ${body.slice(0, 200).trim()}`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(url)) {
        throw error;
      }
    }
    await sleep(1000);
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
};

const signalChildGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
  try {
    process.kill(-(child.pid ?? 0), signal);
  } catch {}
};

// `convex dev` runs the web server in its own process group and stops it
// only on SIGINT, so interrupt first and force-stop whatever remains.
export const stopGroup = async (child: ChildProcess) => {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalChildGroup(child, "SIGINT");
  await Promise.race([exited, sleep(15_000)]);
  signalChildGroup(child, "SIGKILL");
};
