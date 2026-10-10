/**
 * Read-only Convex deployment operations for setup and doctor (issue #407,
 * Phase 4): the local dotenv deployment pointer and the selected deployment's
 * variables. Setup never writes deployment variables. Values are returned to
 * the caller and never logged.
 */

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

/** The deployment's variable names, without values. */
export const listDeploymentVarNames = async (
  cwd: string = convexProjectDir()
): Promise<
  | { status: "found"; names: Set<string> }
  | { status: "unavailable"; detail: string }
> => {
  try {
    const result = await runCommand(
      ["bunx", "convex", "env", "list", "--names-only"],
      { cwd, timeoutMs: 60_000 }
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
