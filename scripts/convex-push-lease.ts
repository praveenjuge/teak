/**
 * Client for the dev deployment's push lease (packages/convex/devPushLease.ts).
 *
 * Every checkout and cloud session shares one dev deployment, so only the
 * lease holder runs `convex dev`. Calls go through `bunx convex run`, which
 * works with a Convex login and with a cloud session's dev deploy key alike.
 */

import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { runCommand } from "./proc.ts";

export const HEARTBEAT_MS = 30_000;

export interface LeaseHolder {
  id: string;
  label: string;
}

export interface LeaseState {
  holder: { expiresAt: number; id: string; label: string } | null;
  lastPush: { at: number; commit: string; label: string } | null;
}

/**
 * Why a lease call failed: the deployed code has no lease functions yet (the
 * first push), the deployment refuses dev tooling (TEAK_DEV_DEPLOYMENT is
 * unset), or anything else, such as a network error, worth retrying.
 */
export type LeaseFailure = "missing-functions" | "refused" | "unreachable";

export type LeaseResult =
  | { granted: boolean; state: LeaseState; status: "ok" }
  | { detail: string; reason: LeaseFailure; status: "unavailable" };

const git = async (root: string, args: string[]): Promise<string> => {
  const result = await runCommand(["git", ...args], {
    cwd: root,
    timeoutMs: 10_000,
  });
  return result.exitCode === 0 ? result.stdout.trim() : "";
};

/** This checkout on this machine; the label says which branch it pushes. */
export const leaseHolder = async (root: string): Promise<LeaseHolder> => {
  const host = hostname();
  const branch =
    (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])) || "unknown";
  const where = root.startsWith(homedir())
    ? `~${root.slice(homedir().length)}`
    : root;
  return { id: `${host}:${root}`, label: `${branch} (${where} on ${host})` };
};

export const headCommit = (root: string): Promise<string> =>
  git(root, ["rev-parse", "--short", "HEAD"]);

/** `convex run` prints the return value as JSON after any log lines. */
export const parseRunOutput = (stdout: string): unknown => {
  const lines = stdout.trim().split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*([{["\d-]|true|false|null)/.test(lines[i] ?? "")) {
      continue;
    }
    try {
      return JSON.parse(lines.slice(i).join("\n"));
    } catch {
      // A log line that only looks like JSON; try the next candidate.
    }
  }
  throw new Error("no JSON result");
};

/** The thrown message from a failed `convex run`, without its stack frames. */
export const convexRunError = (stderr: string): string => {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const thrown = lines.find((line) => /Uncaught \w*Error: /.test(line));
  if (thrown) {
    return thrown.replace(/^.*Uncaught \w*Error: /, "").replace(/\.$/, "");
  }
  return (
    lines.filter((line) => !line.startsWith("at ")).pop() ?? "unknown error"
  );
};

/** Classifies a failed `convex run` of a lease function. */
export const classifyLeaseFailure = (
  stderr: string
): { detail: string; reason: LeaseFailure } => {
  if (/Could not find (public )?function/i.test(stderr)) {
    return {
      reason: "missing-functions",
      detail:
        "the dev deployment doesn't have the push lease yet (push this branch once with `bun run dev --push`)",
    };
  }
  if (stderr.includes("TEAK_DEV_DEPLOYMENT")) {
    return {
      reason: "refused",
      detail: "TEAK_DEV_DEPLOYMENT=true isn't set on the dev deployment",
    };
  }
  return { reason: "unreachable", detail: convexRunError(stderr) };
};

const call = async (
  root: string,
  fn: string,
  args: Record<string, unknown>
): Promise<
  | { ok: true; value: unknown }
  | { detail: string; ok: false; reason: LeaseFailure }
> => {
  try {
    const result = await runCommand(
      ["bunx", "convex", "run", `devPushLease:${fn}`, JSON.stringify(args)],
      { cwd: join(root, "packages/convex"), timeoutMs: 60_000 }
    );
    if (result.exitCode !== 0) {
      return { ok: false, ...classifyLeaseFailure(result.stderr) };
    }
    return { ok: true, value: parseRunOutput(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      reason: "unreachable",
    };
  }
};

const asLease = (outcome: Awaited<ReturnType<typeof call>>): LeaseResult =>
  outcome.ok
    ? {
        status: "ok",
        ...(outcome.value as { granted: boolean; state: LeaseState }),
      }
    : {
        status: "unavailable",
        detail: outcome.detail,
        reason: outcome.reason,
      };

export const acquireLease = async (
  root: string,
  holder: LeaseHolder,
  force: boolean
): Promise<LeaseResult> =>
  asLease(await call(root, "acquire", { holder, force }));

/**
 * Renew the lease. A lease that expired while nobody else took it (a laptop
 * asleep, slow heartbeat calls) is taken back; only another holder ends it.
 */
export const renewLease = async (
  root: string,
  holder: LeaseHolder
): Promise<LeaseResult> => {
  const renewed = asLease(
    await call(root, "heartbeat", { holderId: holder.id })
  );
  if (renewed.status === "ok" && !renewed.granted && !renewed.state.holder) {
    return acquireLease(root, holder, false);
  }
  return renewed;
};

export const releaseLease = async (
  root: string,
  holder: LeaseHolder
): Promise<void> => {
  await call(root, "release", { holderId: holder.id });
};

export const recordPush = async (
  root: string,
  holder: LeaseHolder,
  commit: string
): Promise<void> => {
  await call(root, "recordPush", {
    holderId: holder.id,
    label: holder.label,
    commit,
  });
};

export const leaseStatus = async (
  root: string
): Promise<
  | { state: LeaseState; status: "ok" }
  | { detail: string; status: "unavailable" }
> => {
  const outcome = await call(root, "status", {});
  return outcome.ok
    ? { status: "ok", state: outcome.value as LeaseState }
    : { status: "unavailable", detail: outcome.detail };
};

/** One line about who pushes the dev deployment's backend. */
export const describeLease = (
  state: LeaseState,
  self?: LeaseHolder
): string => {
  let holder = "nobody holds the push lease";
  if (state.holder) {
    holder =
      state.holder.id === self?.id
        ? "this checkout pushes the backend"
        : `${state.holder.label} pushes the backend`;
  }
  const last = state.lastPush
    ? `; live code: ${state.lastPush.label} at ${state.lastPush.commit}`
    : "";
  return `${holder}${last}`;
};
