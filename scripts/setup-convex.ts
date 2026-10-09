/**
 * Convex deployment operations for setup (issue #407, Phase 4).
 *
 * Non-interactive use of the supported Convex flow: read the local dotenv
 * deployment pointer, verify or configure deployment variables, and push
 * with `convex dev --once`. Names only; values are never logged.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readResponseTextWithinLimit } from "../packages/convex/shared/boundedResponse";
import { readConvexSelection } from "./capabilities.ts";
import { parseConvexEnvOutput } from "./check-cloudflare.ts";
import { parseDotenvValue, readDotenvFile } from "./env-loader.ts";
import { runCommand } from "./proc.ts";

const ROOT = join(import.meta.dir, "..");
export const convexProjectDir = (root: string = ROOT): string =>
  join(root, "packages/convex");

export const readConvexDotenvUrls = (
  dotenvPath: string = join(convexProjectDir(), ".env.local")
): { convexUrl?: string; convexSiteUrl?: string } => {
  if (!existsSync(dotenvPath)) {
    return {};
  }
  const content = readFileSync(dotenvPath, "utf-8");
  const convexUrl = parseDotenvValue(content, "NEXT_PUBLIC_CONVEX_URL");
  const convexSiteUrl = parseDotenvValue(
    content,
    "NEXT_PUBLIC_CONVEX_SITE_URL"
  );
  return {
    ...(convexUrl ? { convexUrl } : {}),
    ...(convexSiteUrl ? { convexSiteUrl } : {}),
  };
};

/** Reads one deployment variable. The value is returned, never logged. */
export const readDeploymentVar = async (
  name: string,
  cwd: string = convexProjectDir()
): Promise<
  | { status: "found"; value: string }
  | { status: "missing" }
  | { status: "unavailable"; detail: string }
> => {
  try {
    const result = await runCommand(["bunx", "convex", "env", "get", name], {
      cwd,
      timeoutMs: 60_000,
    });
    const parsed = parseConvexEnvOutput(
      result.stdout,
      result.stderr,
      result.exitCode
    );
    if (parsed.status === "found") {
      return { status: "found", value: parsed.value };
    }
    if (parsed.status === "missing") {
      return { status: "missing" };
    }
    const detail = result.stderr.trim().split("\n").pop() || "unknown error";
    return { status: "unavailable", detail };
  } catch (error) {
    return {
      status: "unavailable",
      detail: error instanceof Error ? error.message : "spawn failed",
    };
  }
};

/** Every deployment variable, read with one CLI call. Values are never logged. */
export const listDeploymentVars = async (
  cwd: string = convexProjectDir()
): Promise<
  | { status: "found"; values: Map<string, string> }
  | { status: "unavailable"; detail: string }
> => {
  try {
    const result = await runCommand(["bunx", "convex", "env", "list"], {
      cwd,
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0) {
      return {
        status: "unavailable",
        detail: result.stderr.trim().split("\n").pop() || "unknown error",
      };
    }
    const values = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (match) {
        values.set(match[1], match[2]);
      }
    }
    return { status: "found", values };
  } catch (error) {
    return {
      status: "unavailable",
      detail: error instanceof Error ? error.message : "spawn failed",
    };
  }
};

/**
 * Local backends keep their state in packages/convex/.convex, inside the
 * functions directory (convex.json sets functions to "."). `convex dev` scans
 * that directory for functions, so the backend's own writes look like code
 * changes and every push restarts forever. The CLI skips any directory that
 * holds a convex.config.ts, so this marker keeps it out of the scan. The
 * directory is ignored by git.
 */
export const ensureLocalStateMarker = (
  cwd: string = convexProjectDir()
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
    "// Written by bun run setup: keeps convex dev from scanning local backend state.\n"
  );
  return "created";
};

// The value goes through stdin (`convex env set NAME` reads it when stdin is
// not a TTY), so secrets never reach argv or the process list.
const convexEnvSet = async (
  name: string,
  value: string,
  cwd: string
): Promise<{ ok: boolean; detail: string }> => {
  const result = await runCommand(["bunx", "convex", "env", "set", name], {
    cwd,
    stdin: value,
    timeoutMs: 60_000,
  });
  return {
    detail:
      result.exitCode === 0
        ? "configured"
        : result.stderr.trim().split("\n").pop() || "unknown error",
    ok: result.exitCode === 0,
  };
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

export interface ConvexDevOnceOptions {
  /** Total attempts; transient failures retry with backoff. Defaults to 3. */
  attempts?: number;
  /** Local backend identity HTTP boundary; defaults to fetch. */
  fetch?: typeof fetch;
  /** A local backend's ports; omitted for a cloud deployment. */
  ports?: LocalBackendPorts;
  /** Subprocess runner; defaults to runCommand. */
  run?: typeof runCommand;
  /** Backoff sleeper; defaults to Bun.sleep. */
  sleepMs?: (ms: number) => Promise<void>;
}

export interface LocalBackendPorts {
  convex: number;
  convexSite: number;
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
  cwd: string = convexProjectDir(),
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
export const setDeploymentVars = async (
  values: Record<string, string>,
  cwd: string = convexProjectDir()
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
        `Could not set ${names.join(", ")}: ${result.stderr.trim().split("\n").pop() || "unknown error"}. Run \`bunx convex login\` (or export CONVEX_AGENT_MODE=anonymous for a local anonymous deployment) and re-run bun run setup.`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const setDeploymentVar = async (
  name: string,
  value: string,
  cwd: string = convexProjectDir()
): Promise<void> => {
  const set = await convexEnvSet(name, value, cwd);
  if (!set.ok) {
    throw new Error(
      `Could not set ${name}: ${set.detail}. Run \`bunx convex login\` (or export CONVEX_AGENT_MODE=anonymous for a local anonymous deployment) and re-run bun run setup.`
    );
  }
};

export const ensureDeploymentVar = async (
  name: string,
  localValue: string,
  cwd: string = convexProjectDir()
): Promise<"already-set" | "configured"> => {
  const current = await readDeploymentVar(name, cwd);
  if (current.status === "found") {
    return "already-set";
  }
  if (current.status === "missing") {
    await setDeploymentVar(name, localValue, cwd);
    return "configured";
  }
  throw new Error(
    `Could not read ${name} from the selected deployment: ${current.detail}. ` +
      "Run `bunx convex login` (or export CONVEX_AGENT_MODE=anonymous for a local anonymous deployment) and re-run bun run setup."
  );
};
