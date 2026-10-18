#!/usr/bin/env bun
/**
 * Read-only health check for verify-teak: is this checkout's running stack
 * worth driving? It checks the recorded stack is alive and ready, the web app
 * answers, and, on the shared dev deployment, which branch's backend is live
 * and whether the last push failed schema validation. It never starts, stops
 * or writes anything, and prints the account email but never its password.
 *
 * Usage: bun .agents/skills/verify-teak/scripts/doctor.ts
 * Exits 1 when the stack must not be driven.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  headCommit,
  leaseHolder,
  leaseStatus,
} from "../../../../scripts/convex-push-lease.ts";
import {
  isStackRunning,
  readStackState,
} from "../../../../scripts/lib/stack-state.ts";
import { runCommand } from "../../../../scripts/proc.ts";

const ROOT = join(import.meta.dir, "../../../..");

type Level = "ok" | "warn" | "fail";
const results: { detail: string; level: Level }[] = [];
const report = (level: Level, detail: string) => {
  results.push({ level, detail });
  console.log(`${{ ok: "✓", warn: "!", fail: "✗" }[level]} ${detail}`);
};

const checkWeb = async (appOrigin: string) => {
  try {
    const response = await fetch(`${appOrigin}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const location = response.headers.get("location") ?? "";
    // No session is sent, so a healthy app redirects to its sign-in route.
    if (
      response.status >= 300 &&
      response.status < 400 &&
      new URL(location, appOrigin).pathname === "/sign-in"
    ) {
      report(
        "ok",
        `web: ${appOrigin}/ answered ${response.status}, redirecting anonymous visitors to sign-in`
      );
    } else {
      report(
        "fail",
        `web: anonymous ${appOrigin}/ answered ${response.status}${location ? ` to ${location}` : ""}, not a redirect to /sign-in`
      );
    }
  } catch (error) {
    report(
      "fail",
      `web: ${appOrigin}/ unreachable (${error instanceof Error ? error.message : String(error)})`
    );
  }
};

const git = (args: string[]) =>
  runCommand(["git", ...args], { cwd: ROOT, timeoutMs: 10_000 });

const checkBackend = async (pushing: boolean) => {
  const [lease, head, dirty] = await Promise.all([
    leaseStatus(ROOT),
    headCommit(ROOT),
    git(["status", "--porcelain", "--", "packages/convex"]),
  ]);
  if (dirty.stdout.trim() && !pushing) {
    report(
      "warn",
      "backend: packages/convex has uncommitted changes and this checkout doesn't push them; relaunch with `bun run dev --stop && bun run dev --detach --push` before verifying them."
    );
  }
  if (lease.status !== "ok") {
    report("warn", `backend: push lease unavailable (${lease.detail})`);
    return;
  }
  const last = lease.state.lastPush;
  if (!last) {
    report("warn", "backend: no push recorded on the dev deployment");
    return;
  }
  // A commit that changed nothing under packages/convex leaves the live
  // backend current, so compare the backend code, not the commit.
  const changed =
    last.commit === head
      ? 0
      : (
          await git([
            "diff",
            "--quiet",
            last.commit,
            "HEAD",
            "--",
            "packages/convex",
          ])
        ).exitCode;
  const self = await leaseHolder(ROOT);
  const verdict = backendVerdict({
    codeMatches: changed === 0,
    pushedBySelf: last.label === self.label,
    pushing,
  });
  const takeOver =
    "take over with `bun run dev --stop && bun run dev --detach --push`";
  if (verdict === "differs") {
    report(
      "warn",
      `backend: live code is ${last.label} at ${last.commit}, and this checkout's packages/convex differs from it. Backend changes here are not live; ${takeOver} before verifying them.`
    );
  } else if (verdict === "current") {
    report(
      "ok",
      `backend: this checkout is pushing its packages/convex (last push at ${last.commit})`
    );
  } else {
    report(
      "warn",
      `backend: live code was pushed by ${last.label} at ${last.commit}, and nothing is syncing this checkout's tree now. Its committed packages/convex matches, but the push may have carried uncommitted changes. Fine for frontend work; for backend work ${takeOver}.`
    );
  }
};

/**
 * How the live backend relates to this checkout. The lease records a push's
 * commit, not its working tree, so the backend is known to be this tree only
 * while this checkout's `convex dev` is pushing it.
 */
export const backendVerdict = (input: {
  codeMatches: boolean;
  pushedBySelf: boolean;
  pushing: boolean;
}): "current" | "differs" | "unverified" => {
  if (!input.codeMatches) {
    return "differs";
  }
  return input.pushedBySelf && input.pushing ? "current" : "unverified";
};

/**
 * Whether the newest push outcome in a stack log is a schema failure. The
 * log lasts as long as the stack and `convex dev` keeps pushing on every
 * save, so a failure that a later push fixed must not count.
 */
export const latestPushFailed = (log: string): boolean =>
  log.lastIndexOf("Schema validation failed") >
  log.lastIndexOf("Convex functions ready!");

const checkLog = (logPath: string) => {
  if (!existsSync(logPath)) {
    return;
  }
  if (latestPushFailed(readFileSync(logPath, "utf-8"))) {
    report(
      "fail",
      `backend: the latest push in ${logPath} failed schema validation, so this branch's backend isn't live (.agents/cloud.md, "The backend you test against")`
    );
  }
};

const main = async () => {
  const state = readStackState(ROOT);
  if (!state) {
    report("fail", "stack: not running. Start it with `bun run dev --detach`.");
    return;
  }
  if (!isStackRunning(state)) {
    report(
      "fail",
      `stack: recorded pid ${state.pid} is gone. Run \`bun run dev --stop\`, then \`bun run dev --detach\`.`
    );
    return;
  }
  if (!state.ready) {
    report(
      "fail",
      "stack: still starting. Wait for `bun run dev --detach` to return."
    );
    return;
  }
  report(
    "ok",
    `stack: ${state.mode} stack ready at ${state.urls.appOrigin} (pid ${state.pid}, started ${state.startedAt})`
  );
  if (state.account) {
    report(
      "ok",
      `account: ${state.account.email} (password in .agents/.state/stack.json)`
    );
  }
  await checkWeb(state.urls.appOrigin);
  if (state.mode === "dev") {
    await checkBackend(state.pushing ?? false);
  }
  checkLog(state.logPath);
};

if (import.meta.main) {
  await main();
  const failed = results.some((result) => result.level === "fail");
  console.log(failed ? "doctor: do not drive this stack" : "doctor: ok");
  process.exit(failed ? 1 : 0);
}
