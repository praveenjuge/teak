import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConvexEnvOutput } from "./check-cloudflare.ts";
import { parseDotenvValue } from "./env-loader.ts";
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

export const readDeploymentVar = async (
  name: string,
  cwd: string = convexProjectDir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<
  | { status: "found"; value: string }
  | { status: "missing" }
  | { status: "unavailable"; detail: string }
> => {
  try {
    const result = await runCommand(["bunx", "convex", "env", "get", name], {
      cwd,
      env,
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

export const listDeploymentVars = async (
  cwd: string = convexProjectDir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<
  | { status: "found"; values: Map<string, string> }
  | { status: "unavailable"; detail: string }
> => {
  try {
    // Since Convex 1.48, `env list` prints only names when an AI agent runs
    // it, so ask for the values explicitly.
    const result = await runCommand(
      ["bunx", "convex", "env", "list", "--include-values"],
      { cwd, env, timeoutMs: 60_000 }
    );
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

export const listDeploymentVarNames = async (
  cwd: string = convexProjectDir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<
  | { status: "found"; names: Set<string> }
  | { status: "unavailable"; detail: string }
> => {
  try {
    const result = await runCommand(
      ["bunx", "convex", "env", "list", "--names-only"],
      { cwd, env, timeoutMs: 60_000 }
    );
    if (result.exitCode !== 0) {
      return {
        status: "unavailable",
        detail: result.stderr.trim().split("\n").pop() || "unknown error",
      };
    }
    return {
      status: "found",
      names: new Set(
        result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(line))
      ),
    };
  } catch (error) {
    return {
      status: "unavailable",
      detail: error instanceof Error ? error.message : "spawn failed",
    };
  }
};
