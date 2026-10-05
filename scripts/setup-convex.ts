/**
 * Convex deployment operations for setup (issue #407, Phase 4).
 *
 * Non-interactive use of the supported Convex flow: read the local dotenv
 * deployment pointer, verify or configure deployment variables, and push
 * with `convex dev --once`. Names only; values are never logged.
 */

import { existsSync, readFileSync } from "node:fs";
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

const convexEnvGet = async (
  name: string,
  cwd: string
): Promise<
  | { status: "found" }
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
      return { status: "found" };
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

const convexEnvSet = async (
  name: string,
  value: string,
  cwd: string
): Promise<{ ok: boolean; detail: string }> => {
  const result = await runCommand(
    ["bunx", "convex", "env", "set", name, value],
    { cwd, timeoutMs: 60_000 }
  );
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
  /ENOENT[^\n]*convex_local_backend\.sqlite3-journal|SQLITE_BUSY|ECONNREFUSED[^\n]*127\.0\.0\.1:3210/i;

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
  /** Subprocess runner; defaults to runCommand. */
  run?: typeof runCommand;
  /** Backoff sleeper; defaults to Bun.sleep. */
  sleepMs?: (ms: number) => Promise<void>;
}

// A port collision is not enough to classify shutdown as transient. Confirm
// the selected anonymous backend's identity before retrying; never stop it.
async function selectedBackendIsShuttingDown(
  output: string,
  cwd: string,
  fetchImpl: typeof fetch
): Promise<boolean> {
  if (
    !output.includes(
      "A local backend is still running on port 3210. Please stop it and run this command again."
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
    const response = await fetchImpl("http://127.0.0.1:3210/instance_name", {
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
    const result = await run(["bunx", "convex", "dev", "--once"], {
      cwd,
      timeoutMs: 300_000,
    });
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
          opts?.fetch ?? fetch
        )));
    if (!(transient && attempt < attempts)) {
      break;
    }
    await sleepMs(2000 * attempt);
  }
  return { detail, ok: false };
};

export const ensureDeploymentVar = async (
  name: string,
  localValue: string,
  cwd: string = convexProjectDir()
): Promise<"already-set" | "configured"> => {
  const current = await convexEnvGet(name, cwd);
  if (current.status === "found") {
    return "already-set";
  }
  if (current.status === "missing") {
    const set = await convexEnvSet(name, localValue, cwd);
    if (!set.ok) {
      throw new Error(
        `Could not set ${name}: ${set.detail}. Run \`bunx convex login\` (or export CONVEX_AGENT_MODE=anonymous for a local anonymous deployment) and re-run bun run setup.`
      );
    }
    return "configured";
  }
  throw new Error(
    `Could not read ${name} from the selected deployment: ${current.detail}. ` +
      "Run `bunx convex login` (or export CONVEX_AGENT_MODE=anonymous for a local anonymous deployment) and re-run bun run setup."
  );
};
