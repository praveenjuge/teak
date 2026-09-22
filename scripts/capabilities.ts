/**
 * Runtime probes and setup capability planning (issue #407, Phase 4).
 *
 * Shared by setup and doctor: pinned runtime versions (Bun and Node share
 * one policy: exact required, patch drift warns), port probes, LAN host
 * inference for physical-device mobile work, and the read-only capability
 * report behind `setup --check --json`. Names only, never values.
 */

import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
  utimesSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { loadTargetEnv, parseDotenvValue } from "./env-loader.ts";
import type { ConvexMode, SupportedTarget } from "./env-targets.ts";
import { runCommand } from "./proc.ts";
import type { WorktreePorts } from "./worktree-env.ts";

export type VersionStatus = "ok" | "warn" | "mismatch";

export const checkRuntimeVersion = (
  actual: string,
  required: string
): VersionStatus => {
  const clean = actual.replace(/^v/, "");
  if (clean === required) {
    return "ok";
  }
  const [actualMajor, actualMinor] = clean.split(".");
  const [requiredMajor, requiredMinor] = required.split(".");
  return actualMajor === requiredMajor && actualMinor === requiredMinor
    ? "warn"
    : "mismatch";
};

export const requiredNodeVersion = (
  engines: unknown,
  packageManager: string
): string => {
  const node = (engines as { node?: unknown } | undefined)?.node;
  if (typeof node !== "string" || !/^\d+\.\d+\.\d+$/.test(node.trim())) {
    throw new Error(
      `package.json engines.node must pin an exact version (found ${JSON.stringify(node)} alongside ${packageManager})`
    );
  }
  return node.trim();
};

/**
 * System Node version. Bun's process.version reports Bun's Node
 * compatibility instead, so the real toolchain needs a subprocess.
 */
export const readNodeVersion = async (): Promise<string | null> => {
  try {
    const result = await runCommand(["node", "--version"], {
      cwd: join(import.meta.dir, ".."),
      timeoutMs: 10_000,
    });
    const match = /^v(\d+\.\d+\.\d+)/.exec(result.stdout.trim());
    return result.exitCode === 0 && match ? match[1] : null;
  } catch {
    return null;
  }
};

export const readPinnedVersions = (
  root: string
): { bun: string; node: string } => {
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf-8")
  ) as { engines?: unknown; packageManager?: string };
  if (!packageJson.packageManager) {
    throw new Error("packageManager is not pinned in package.json");
  }
  const bun = packageJson.packageManager.replace(/^bun@/, "");
  if (!/^\d+\.\d+\.\d+$/.test(bun)) {
    throw new Error(
      `Unsupported packageManager "${packageJson.packageManager}" (expected bun@x.y.z)`
    );
  }
  return {
    bun,
    node: requiredNodeVersion(packageJson.engines, packageJson.packageManager),
  };
};

export interface RuntimeVersionCheck {
  detail?: string;
  id: string;
  ok: boolean;
  remediation?: string[];
  severity: "error" | "warn";
}

const versionCheck = (
  id: string,
  label: string,
  actual: string,
  pinned: string
): RuntimeVersionCheck => {
  const status = checkRuntimeVersion(actual, pinned);
  if (status === "ok") {
    return {
      detail: `${label} ${actual} matches pinned ${pinned}`,
      id,
      ok: true,
      severity: "error",
    };
  }
  if (status === "warn") {
    return {
      detail: `${label} ${actual} drifts from pinned ${pinned} (patch only)`,
      id,
      ok: true,
      severity: "warn",
    };
  }
  return {
    detail: `${label} ${actual} does not match pinned ${pinned}`,
    id,
    ok: false,
    remediation: [`Install ${label} ${pinned} and re-run`],
    severity: "error",
  };
};

export const checkBunVersion = (
  root: string = join(import.meta.dir, "..")
): RuntimeVersionCheck => {
  let pinned: string;
  try {
    pinned = readPinnedVersions(root).bun;
  } catch {
    return {
      id: "bun-version",
      ok: false,
      severity: "error",
      detail: "packageManager is not pinned in package.json",
      remediation: ["Pin packageManager to bun@x.y.z"],
    };
  }
  return versionCheck("bun-version", "Bun", Bun.version, pinned);
};

export const checkNodeVersion = async (
  root: string = join(import.meta.dir, "..")
): Promise<RuntimeVersionCheck> => {
  let pinned: string;
  try {
    pinned = readPinnedVersions(root).node;
  } catch {
    return {
      id: "node-version",
      ok: false,
      severity: "error",
      detail: "engines.node is not pinned in package.json",
      remediation: ["Pin engines.node to an exact version in package.json"],
    };
  }
  const actual = await readNodeVersion();
  if (!actual) {
    return {
      id: "node-version",
      ok: false,
      severity: "error",
      detail: "Node.js is not installed",
      remediation: [`Install Node ${pinned} and re-run`],
    };
  }
  return versionCheck("node-version", "Node", `v${actual}`, pinned);
};

export const isInstallStale = (root: string): boolean => {
  const modules = join(root, "node_modules");
  const lock = join(root, "bun.lock");
  if (!(existsSync(modules) && existsSync(lock))) {
    return true;
  }
  return statSync(lock).mtimeMs > statSync(modules).mtimeMs;
};

/**
 * Record a completed install. Bun finishes by writing the lockfile, so a
 * fresh install always leaves the lock newer than the modules directory;
 * without this marker the staleness check above would fail right after its
 * own remediation. Setup calls this after a successful `bun ci`. The stamp
 * copies the lockfile's own mtime (equality satisfies the strict check),
 * which also holds on coarse filesystems and across clock adjustments.
 */
export const markInstallFresh = (root: string): void => {
  const lockMtime = statSync(join(root, "bun.lock")).mtime;
  utimesSync(join(root, "node_modules"), lockMtime, lockMtime);
};

export type ConvexSelectionSource = "env" | "dotenv" | "none";

export interface ConvexSelection {
  deployment?: string;
  source: ConvexSelectionSource;
}

/** Explicit Convex deployment selection: shell export, then CLI dotenv. */
export const readConvexSelection = (
  env: NodeJS.ProcessEnv = process.env,
  dotenvPath: string = join(import.meta.dir, "..", "packages/convex/.env.local")
): ConvexSelection => {
  const fromEnv = env.CONVEX_DEPLOYMENT?.trim();
  if (fromEnv) {
    return { deployment: fromEnv, source: "env" };
  }
  if (existsSync(dotenvPath)) {
    const fromDotenv = parseDotenvValue(
      readFileSync(dotenvPath, "utf-8"),
      "CONVEX_DEPLOYMENT"
    )?.trim();
    if (fromDotenv) {
      return { deployment: fromDotenv, source: "dotenv" };
    }
  }
  return { source: "none" };
};

export const isPortOccupied = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(true);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(false);
      });
    });
    server.listen(port, "127.0.0.1");
  });

/** First non-internal IPv4 address, for physical-device mobile URLs. */
export const inferLanHost = (): string | null => {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
};

export const checkTcp = (
  host: string,
  port: number,
  timeoutMs = 2000
): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.setTimeout(timeoutMs);
  });

const isWritable = (path: string): boolean => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

export interface FilesystemCapability {
  path: string;
  writable: boolean;
}

export interface NetworkCapability {
  host: string;
  port: number;
  purpose: string;
  reachable: boolean | null;
  required: boolean;
}

export interface ToolingCapability {
  actual: string;
  name: string;
  required: string;
  status: VersionStatus | "missing";
}

export interface CredentialCapability {
  name: string;
  present: boolean | null;
  required: boolean;
}

export interface PortCapability {
  free: boolean | null;
  port: number;
  purpose: string;
}

export interface Capabilities {
  credentials: CredentialCapability[];
  filesystem: FilesystemCapability[];
  network: NetworkCapability[];
  plannedWrites: string[];
  ports: PortCapability[];
  tooling: ToolingCapability[];
}

/** Repo-relative paths setup would create or repair, computed read-only. */
export const plannedWritesFor = (
  target: SupportedTarget,
  convex: ConvexMode,
  root: string
): string[] => {
  const writes: string[] = [];
  if (isInstallStale(root)) {
    writes.push("node_modules/ (bun ci)");
  }
  const loaded = loadTargetEnv(target, "local", root);
  for (const file of loaded.files) {
    if (!file.exists) {
      writes.push(`${file.path} (generate)`);
    }
  }
  if (convex !== "skip") {
    writes.push("packages/convex/_generated/ (convex codegen)");
  }
  return writes;
};

export const planCapabilities = async (options: {
  checkNetwork: boolean;
  convex: ConvexMode;
  root: string;
  target: SupportedTarget;
  worktree: WorktreePorts;
}): Promise<Capabilities> => {
  const { convex, root, target, worktree } = options;
  const pinned = readPinnedVersions(root);
  const bunStatus = checkRuntimeVersion(Bun.version, pinned.bun);
  const nodeActual = await readNodeVersion();
  const nodeStatus: VersionStatus | "missing" = nodeActual
    ? checkRuntimeVersion(nodeActual, pinned.node)
    : "missing";
  const stale = isInstallStale(root);

  const network: NetworkCapability[] = [
    {
      host: "registry.npmjs.org",
      port: 443,
      purpose: "bun ci (only when node_modules is stale)",
      required: stale,
      reachable: null,
    },
  ];
  if (options.checkNetwork) {
    for (const entry of network) {
      entry.reachable = entry.required
        ? await checkTcp(entry.host, entry.port)
        : null;
    }
  }

  const selection = readConvexSelection(
    process.env,
    join(root, "packages/convex/.env.local")
  );
  const credentials: CredentialCapability[] = [];
  if (convex === "cloud") {
    credentials.push({
      name: "CONVEX_DEPLOYMENT or convex CLI login",
      required: true,
      present: selection.deployment ? true : null,
    });
  }

  const ports: PortCapability[] = [
    { port: worktree.web, purpose: "web app", free: null },
    { port: worktree.docs, purpose: "docs site", free: null },
  ];
  if (!worktree.namespaced) {
    ports.push(
      { port: worktree.convex, purpose: "local convex backend", free: null },
      { port: worktree.convexSite, purpose: "local convex http", free: null }
    );
  }
  for (const entry of ports) {
    entry.free = !(await isPortOccupied(entry.port));
  }

  return {
    filesystem: [
      {
        path: "node_modules/",
        writable: isWritable(join(root, "node_modules")) || isWritable(root),
      },
      { path: "apps/*/.env.local", writable: isWritable(join(root, "apps")) },
      {
        path: "packages/convex/.env.local",
        writable: isWritable(join(root, "packages/convex")),
      },
    ],
    network,
    tooling: [
      {
        name: "bun",
        required: pinned.bun,
        actual: Bun.version,
        status: bunStatus,
      },
      {
        name: "node",
        required: pinned.node,
        actual: nodeActual ? `v${nodeActual}` : "missing",
        status: nodeStatus,
      },
    ],
    credentials,
    ports,
    plannedWrites: plannedWritesFor(target, convex, root),
  };
};
