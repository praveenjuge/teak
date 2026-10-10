/**
 * The E2E suite's local Convex backend: selected, provisioned and pointed at
 * the WorkOS emulator before the stack starts (./stack.ts pushes the code
 * once). It uses test-only values (./config.ts) and no secrets, and never a
 * cloud deployment. It takes over packages/convex/.env.local while the suite
 * runs; the next `bun run dev` selects the shared dev deployment again.
 * Deployment values are never logged.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConvexSelection } from "../../../../scripts/capabilities.ts";
import {
  DEV_DEPLOYMENT,
  writeConvexSelection,
} from "../../../../scripts/dev-deployment.ts";
import { readDotenvFile } from "../../../../scripts/env-loader.ts";
import { runCommand } from "../../../../scripts/proc.ts";
import { listDeploymentVars } from "../../../../scripts/setup-convex.ts";
import { isMachineLocalValue } from "../../../../scripts/setup-derived-env.ts";
import type { WorktreePorts } from "../../../../scripts/worktree-env.ts";
import { readResponseTextWithinLimit } from "../../../convex/shared/boundedResponse";
import { emulatorDeploymentVars } from "./config";

/** No deployment yet (convex dev provisions a local one) or a local backend. */
export const isLocalSelection = (deployment: string | undefined): boolean =>
  !deployment ||
  deployment.startsWith("anonymous:") ||
  deployment.startsWith("local:");

/**
 * Local backends keep their state in packages/convex/.convex, inside the
 * functions directory (convex.json sets functions to "."). `convex dev` scans
 * that directory for functions, so the backend's own writes look like code
 * changes and every push restarts forever. The CLI skips any directory that
 * holds a convex.config.ts, so this marker keeps it out of the scan. The
 * directory is ignored by git.
 */
export const ensureLocalStateMarker = (
  cwd: string
): "created" | "exists" | "no-local-state" => {
  const dir = join(cwd, ".convex");
  const marker = join(dir, "convex.config.ts");
  if (!existsSync(dir)) {
    return "no-local-state";
  }
  if (existsSync(marker)) {
    return "exists";
  }
  writeFileSync(
    marker,
    "// Written by the E2E suite: keeps convex dev from scanning local backend state.\n"
  );
  return "created";
};

/**
 * Transient local-backend failures worth retrying. Every `convex dev --once`
 * run starts its own SQLite-backed local backend; when a previous run shuts
 * down uncleanly (e.g. the provision push that fails on missing SITE_URL by
 * design), the next run can stat a journal file that vanished mid-startup:
 * ENOENT on convex_local_backend.sqlite3-journal. Retrying starts a fresh
 * backend. The SQLite alternative requires that ENOENT journal signature so
 * deterministic database errors fail fast instead of retrying.
 */
const TRANSIENT_PUSH_FAILURE =
  /ENOENT[^\n]*convex_local_backend\.sqlite3-journal|SQLITE_BUSY|ECONNREFUSED[^\n]*127\.0\.0\.1:\d+/i;

export const isTransientPushFailure = (output: string): boolean =>
  TRANSIENT_PUSH_FAILURE.test(output);

export const summarizePushFailure = (stderr: string): string => {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const signal = lines.find((line) =>
    /error|required|not set|missing|cannot|failed/i.test(line)
  );
  const tail = lines.slice(-3);
  const parts = signal && !tail.includes(signal) ? [signal, ...tail] : tail;
  return parts.join(" ") || "unknown error";
};

export interface LocalBackendPorts {
  convex: number;
  convexSite: number;
}

export interface ConvexDevOnceOptions {
  /** Total attempts; transient failures retry with backoff. Defaults to 3. */
  attempts?: number;
  /** Local backend identity HTTP boundary; defaults to fetch. */
  fetch?: typeof fetch;
  /** The local backend's ports. */
  ports?: LocalBackendPorts;
  /** Subprocess runner; defaults to runCommand. */
  run?: typeof runCommand;
  /** Backoff sleeper; defaults to Bun.sleep. */
  sleepMs?: (ms: number) => Promise<void>;
}

/**
 * `convex dev` arguments that bind a local backend to this checkout's ports.
 * The flags are hidden in the Convex CLI but stable; without them every
 * checkout's backend starts at 3210 and takes the next free port.
 */
export const localBackendArgs = (ports?: LocalBackendPorts): string[] =>
  ports
    ? [
        "--local-cloud-port",
        String(ports.convex),
        "--local-site-port",
        String(ports.convexSite),
      ]
    : [];

// A port collision is not enough to classify shutdown as transient. Confirm
// the selected anonymous backend's identity before retrying; never stop it.
async function selectedBackendIsShuttingDown(
  output: string,
  cwd: string,
  fetchImpl: typeof fetch,
  port: number
): Promise<boolean> {
  if (
    !output.includes(
      `A local backend is still running on port ${port}. Please stop it and run this command again.`
    )
  ) {
    return false;
  }
  const dotenvPath = join(cwd, ".env.local");
  const fileValues = readDotenvFile(dotenvPath)?.values;
  const mode =
    process.env.CONVEX_AGENT_MODE?.trim() ||
    fileValues?.get("CONVEX_AGENT_MODE")?.trim();
  const deployKey =
    process.env.CONVEX_DEPLOY_KEY?.trim() ||
    fileValues?.get("CONVEX_DEPLOY_KEY")?.trim();
  if (mode !== "anonymous" || deployKey) {
    return false;
  }
  const selected = readConvexSelection(process.env, dotenvPath).deployment;
  const match = selected?.match(/^anonymous:(anonymous-[A-Za-z0-9_-]+)$/);
  if (!match) {
    return false;
  }
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/instance_name`, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) {
      return false;
    }
    const instance = await readResponseTextWithinLimit(response, 128);
    return instance === match[1];
  } catch {
    return false;
  }
}

export const convexDevOnce = async (
  cwd: string,
  opts?: ConvexDevOnceOptions
): Promise<{ ok: boolean; detail: string }> => {
  const requestedAttempts = opts?.attempts ?? 3;
  const attempts = Number.isFinite(requestedAttempts)
    ? Math.max(1, Math.floor(requestedAttempts))
    : 3;
  const run = opts?.run ?? runCommand;
  const sleepMs = opts?.sleepMs ?? Bun.sleep;
  let detail = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await run(
      ["bunx", "convex", "dev", "--once", ...localBackendArgs(opts?.ports)],
      { cwd, timeoutMs: 300_000 }
    );
    if (result.exitCode === 0) {
      return { detail: "pushed", ok: true };
    }
    const output = `${result.stderr}\n${result.stdout}`;
    detail = summarizePushFailure(output);
    const transient =
      isTransientPushFailure(output) ||
      (attempt < attempts &&
        (await selectedBackendIsShuttingDown(
          output,
          cwd,
          opts?.fetch ?? fetch,
          opts?.ports?.convex ?? 3210
        )));
    if (!(transient && attempt < attempts)) {
      break;
    }
    await sleepMs(2000 * attempt);
  }
  return { detail, ok: false };
};

/**
 * Set several variables with one CLI call. The values go through a private
 * temporary file that is removed right after; they are never logged.
 */
const setDeploymentVars = async (
  values: Record<string, string>,
  cwd: string
): Promise<void> => {
  const names = Object.keys(values);
  if (names.length === 0) {
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "teak-convex-env-"));
  const file = join(dir, "vars.env");
  try {
    writeFileSync(
      file,
      `${names.map((name) => `${name}=${JSON.stringify(values[name])}`).join("\n")}\n`,
      { mode: 0o600 }
    );
    const result = await runCommand(
      ["bunx", "convex", "env", "set", "--force", "--from-file", file],
      { cwd, timeoutMs: 60_000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not set ${names.join(", ")} on the local backend: ${result.stderr.trim().split("\n").pop() || "unknown error"}`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export type DeploymentVarsResult =
  | { configured: string[]; ok: true }
  | { detail: string; ok: false };

/**
 * Set every missing variable and refresh machine-local ones (old ports).
 * A different value a person set is a conflict and is left alone.
 */
export const ensureDeploymentVars = async (
  convexDir: string,
  desired: Record<string, string>,
  /** The deployment's variables when the caller already read them. */
  known?: Awaited<ReturnType<typeof listDeploymentVars>>
): Promise<DeploymentVarsResult> => {
  const listed = known ?? (await listDeploymentVars(convexDir));
  if (listed.status === "unavailable") {
    return {
      ok: false,
      detail: `could not read the deployment's variables: ${listed.detail}`,
    };
  }
  const conflicts: string[] = [];
  const toSet: [string, string][] = [];
  for (const [name, value] of Object.entries(desired)) {
    const current = listed.values.get(name);
    if (current === value) {
      continue;
    }
    if (
      current === undefined ||
      (isMachineLocalValue(name, current) && isMachineLocalValue(name, value))
    ) {
      toSet.push([name, value]);
    } else {
      conflicts.push(name);
    }
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      detail: `the deployment already sets ${conflicts.join(", ")} to other values`,
    };
  }
  await setDeploymentVars(Object.fromEntries(toSet), convexDir);
  return { ok: true, configured: toSet.map(([name]) => name) };
};

/**
 * Select (or provision) this checkout's local backend and point it at the
 * WorkOS emulator. Returns what it did; throws with a remedy on failure.
 */
export const setupBackend = async (
  root: string,
  worktree: WorktreePorts
): Promise<string[]> => {
  const convexDir = join(root, "packages/convex");
  const dotenvPath = join(convexDir, ".env.local");
  const done: string[] = [];

  let selection = readConvexSelection(process.env, dotenvPath);
  if (
    selection.deployment === DEV_DEPLOYMENT &&
    selection.source === "dotenv"
  ) {
    // Dev's selection: the E2E backend takes its turn.
    writeConvexSelection(dotenvPath, null);
    selection = { source: "none" };
    done.push(`switched packages/convex/.env.local from ${DEV_DEPLOYMENT}`);
  }
  // An exported cloud selection would aim the suite at a shared deployment.
  if (!isLocalSelection(selection.deployment)) {
    throw new Error(
      `CONVEX_DEPLOYMENT selects ${selection.deployment}; the E2E suite needs a local backend. Unset the CONVEX_DEPLOYMENT export or remove it from packages/convex/.env.local, then re-run.`
    );
  }
  // The E2E stack never uses a cloud deployment: drop a cloud session's deploy
  // key, and have every child Convex CLI pick the local anonymous backend.
  delete process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_AGENT_MODE = "anonymous";
  const ports = { convex: worktree.convex, convexSite: worktree.convexSite };

  // Provision first when nothing is selected: the first push may fail on
  // missing variables, which the next step configures before the stack's push.
  if (!selection.deployment) {
    const provision = await convexDevOnce(convexDir, { ports });
    done.push(
      provision.ok
        ? `provisioned a local backend (${provision.detail})`
        : `provisioned a local backend (first push deferred: ${provision.detail})`
    );
  }
  ensureLocalStateMarker(convexDir);
  // auth.config.ts reads the WorkOS values, so they are set before the push.
  const vars = await ensureDeploymentVars(convexDir, {
    SITE_URL: worktree.siteUrl,
    ...emulatorDeploymentVars(worktree),
  });
  if (!vars.ok) {
    throw new Error(
      `${vars.detail}. Remove those variables with \`bunx convex env remove <NAME>\` in packages/convex and re-run.`
    );
  }
  done.push(
    vars.configured.length > 0
      ? `configured ${vars.configured.join(", ")} for the WorkOS emulator`
      : "the local backend already points at the WorkOS emulator"
  );
  return done;
};
