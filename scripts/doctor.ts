#!/usr/bin/env bun
/**
 * Validate the local development environment.
 *
 * Hard failures (exit 1): wrong Bun version, missing dependencies, missing
 * web env file. Everything else is a warning with a suggested fix.
 * Usage: bun run doctor
 */

import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  checkBunVersion,
  isInstallStale,
  requiredBunVersion,
} from "./setup.ts";

const ROOT = join(import.meta.dir, "..");

export const REQUIRED_WEB_ENV_KEYS = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
] as const;

export const findMissingKeys = (
  content: string,
  keys: readonly string[]
): string[] => {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    if (!key || values.has(key)) {
      continue;
    }
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    values.set(key, value);
  }
  return keys.filter((key) => {
    const value = values.get(key);
    return value === undefined || value === "";
  });
};

export const isPortOccupied = (
  port: number,
  timeoutMs = 500
): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({
      host: "127.0.0.1",
      port,
      timeout: timeoutMs,
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });

interface Finding {
  detail: string;
  label: string;
  ok: boolean;
}

const main = async (): Promise<void> => {
  const findings: Finding[] = [];
  let hardFailure = false;

  const rootManifest = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf-8")
  );
  const required = requiredBunVersion(rootManifest.packageManager);
  const bunStatus = checkBunVersion(Bun.version, required);
  findings.push({
    ok: bunStatus !== "mismatch",
    label: "Bun version",
    detail: `current ${Bun.version}, required ${required}`,
  });
  if (bunStatus === "mismatch") {
    hardFailure = true;
  }

  const stale = isInstallStale(ROOT);
  findings.push({
    ok: !stale,
    label: "Dependencies",
    detail: stale
      ? "node_modules missing or older than bun.lock: run bun run setup."
      : "node_modules up to date with bun.lock.",
  });
  if (stale) {
    hardFailure = true;
  }

  const webEnvPath = join(ROOT, "apps/web/.env.local");
  if (existsSync(webEnvPath)) {
    const missing = findMissingKeys(
      readFileSync(webEnvPath, "utf-8"),
      REQUIRED_WEB_ENV_KEYS
    );
    findings.push({
      ok: missing.length === 0,
      label: "Web env",
      detail:
        missing.length === 0
          ? "Convex URLs present."
          : `missing keys: ${missing.join(", ")}`,
    });
    if (missing.length > 0) {
      hardFailure = true;
    }
  } else {
    findings.push({
      ok: false,
      label: "Web env",
      detail: "apps/web/.env.local missing: run bun run setup.",
    });
    hardFailure = true;
  }

  for (const port of [3000, 3001, 3210, 3211]) {
    const occupied = await isPortOccupied(port);
    findings.push({
      ok: true,
      label: `Port ${port}`,
      detail: occupied ? "occupied (warn)." : "free.",
    });
  }

  const convex = Bun.spawnSync(["bunx", "convex", "--version"], {
    cwd: join(ROOT, "packages/convex"),
    stdout: "pipe",
    stderr: "pipe",
  });
  findings.push({
    ok: true,
    label: "Convex CLI",
    detail:
      convex.exitCode === 0
        ? "reachable."
        : "unavailable (warn): run bunx convex dev from packages/convex.",
  });

  const remoteCache =
    Boolean(process.env.TURBO_TOKEN) ||
    existsSync(join(homedir(), ".turbo", "credentials.json"));
  findings.push({
    ok: true,
    label: "Turborepo remote cache",
    detail: remoteCache
      ? "credentials present."
      : "local-only (warn): run turbo login for shared cache hits.",
  });

  for (const finding of findings) {
    console.log(
      `${finding.ok ? "✓" : "✗"} ${finding.label}: ${finding.detail}`
    );
  }
  if (hardFailure) {
    process.exitCode = 1;
    console.log("doctor: hard failures found, see ✗ lines above.");
  } else {
    console.log("doctor: environment looks good.");
  }
};

if (import.meta.main) {
  await main();
}
