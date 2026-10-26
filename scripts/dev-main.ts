#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDevCommand,
  type DevArgs,
  needsWebEnv,
  parseDevArgs,
  usesWebStack,
} from "./dev.ts";
import { DEV_DEPLOYMENT_URLS } from "./dev-deployment.ts";
import { DEV_LOG_PATH, startDevStack } from "./dev-stack.ts";
import { validateWebEnvContent } from "./validate-env.ts";
import { resolveWorktree } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");

const runWebStack = async (push: boolean): Promise<number> => {
  const ports = await resolveWorktree(ROOT);
  console.log("Starting the web app…");
  let stack: Awaited<ReturnType<typeof startDevStack>>;
  try {
    stack = await startDevStack({ echo: true, ports, push });
  } catch (error) {
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
  console.log(
    [
      "",
      `Teak is running (${ports.namespace})`,
      `  Web       ${stack.state.urls.appOrigin}`,
      `  Convex    ${stack.state.urls.convexUrl} (shared dev deployment)`,
      ...stack.notes.map((note) => `  ${note}`),
      `  Logs      ${DEV_LOG_PATH.replace(`${ROOT}/`, "")}`,
      "Stop with Ctrl-C or `bun run dev --stop`.",
      "",
    ].join("\n")
  );
  await stack.exited;
  await stack.stop();
  console.error(`The stack exited. See ${DEV_LOG_PATH}.`);
  return 1;
};

const webEnvValid = (): boolean => {
  const path = join(ROOT, "apps/web/.env.local");
  return (
    existsSync(path) &&
    validateWebEnvContent(readFileSync(path, "utf-8")).length === 0
  );
};

const surfaceEnv = async (): Promise<Record<string, string>> => {
  const ports = await resolveWorktree(ROOT);
  return {
    PORT: String(ports.web),
    DOCS_PORT: String(ports.docs),
    EXTENSION_PORT: String(ports.extension),
    TEAK_DEV_API_URL:
      process.env.TEAK_DEV_API_URL ?? DEV_DEPLOYMENT_URLS.convexSiteUrl,
  };
};

const runSurfaces = async (args: DevArgs): Promise<number> => {
  if (needsWebEnv(args.target, args.all) && !webEnvValid()) {
    console.error(
      "✗ apps/web/.env.local missing or invalid — run: bun run setup && bun run doctor."
    );
    return 1;
  }
  if (args.headless) {
    console.log("dev --headless: streaming output, no interactive input.");
  }
  const result = Bun.spawnSync(
    buildDevCommand(args.target, { all: args.all }),
    {
      cwd: ROOT,
      stdout: "inherit",
      stderr: "inherit",
      stdin: args.headless ? "ignore" : "inherit",
      env: { ...process.env, ...(await surfaceEnv()) },
    }
  );
  return result.exitCode ?? 1;
};

if (import.meta.main) {
  const args = parseDevArgs(process.argv.slice(2));
  process.exitCode = usesWebStack(args)
    ? await runWebStack(args.push)
    : await runSurfaces(args);
}
