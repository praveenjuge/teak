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
  leaseStatus,
} from "../../../../scripts/convex-push-lease.ts";
import {
  isStackRunning,
  readStackState,
} from "../../../../scripts/lib/stack-state.ts";

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
    if (response.status >= 400) {
      report("fail", `web: ${appOrigin}/ answered ${response.status}`);
    } else if (response.status >= 300 && !location) {
      report("fail", `web: ${appOrigin}/ redirected without a location`);
    } else {
      report(
        "ok",
        `web: ${appOrigin}/ answered ${response.status}${location ? " (redirects anonymous visitors to sign-in)" : ""}`
      );
    }
  } catch (error) {
    report(
      "fail",
      `web: ${appOrigin}/ unreachable (${error instanceof Error ? error.message : String(error)})`
    );
  }
};

const checkBackend = async () => {
  const [lease, head] = await Promise.all([
    leaseStatus(ROOT),
    headCommit(ROOT),
  ]);
  if (lease.status !== "ok") {
    report("warn", `backend: push lease unavailable (${lease.detail})`);
    return;
  }
  const last = lease.state.lastPush;
  if (!last) {
    report("warn", "backend: no push recorded on the dev deployment");
  } else if (last.commit === head) {
    report(
      "ok",
      `backend: live code is this commit (${last.label} at ${last.commit})`
    );
  } else {
    report(
      "warn",
      `backend: live code is ${last.label} at ${last.commit}, not this checkout's ${head}. Backend changes on this branch are not live; take over with \`bun run dev --stop && bun run dev --detach --push\` before verifying them.`
    );
  }
};

const checkLog = (logPath: string) => {
  if (!existsSync(logPath)) {
    return;
  }
  const log = readFileSync(logPath, "utf-8");
  if (log.includes("Schema validation failed")) {
    report(
      "fail",
      `backend: ${logPath} reports "Schema validation failed", so this branch's backend never pushed (.agents/cloud.md, "The backend you test against")`
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
    await checkBackend();
  }
  checkLog(state.logPath);
};

await main();
const failed = results.some((result) => result.level === "fail");
console.log(failed ? "doctor: do not drive this stack" : "doctor: ok");
process.exit(failed ? 1 : 0);
