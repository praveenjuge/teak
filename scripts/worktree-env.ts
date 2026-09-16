/**
 * Deterministic worktree namespaces and ports (issue #407, Phase 4).
 *
 * The main checkout keeps the historical fixed ports. Linked worktrees get
 * deterministic ports derived from their absolute path, so two checkouts run
 * their local web/Convex stacks concurrently without collisions.
 */

import { runCommand } from "./proc.ts";

export interface WorktreePorts {
  convex: number;
  convexSite: number;
  docs: number;
  /** Short stable namespace; "main" for the primary checkout. */
  namespace: string;
  namespaced: boolean;
  /** App origin for this checkout's SITE_URL. */
  siteUrl: string;
  web: number;
}

export const MAIN_PORTS = {
  web: 3000,
  docs: 3001,
  convex: 3210,
  convexSite: 3211,
} as const;

export const MAIN_SITE_URL = "http://localhost:3000";

const SLOT_COUNT = 40;
const SLOT_STRIDE = 100;
const SLOT_BASE = 4000;

/** FNV-1a 32-bit hash for stable slot assignment. */
export const hashPath = (path: string): number => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < path.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a requires it
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a requires it
  return hash >>> 0;
};

export const mainWorktreePorts = (): WorktreePorts => ({
  namespace: "main",
  namespaced: false,
  web: MAIN_PORTS.web,
  docs: MAIN_PORTS.docs,
  convex: MAIN_PORTS.convex,
  convexSite: MAIN_PORTS.convexSite,
  siteUrl: MAIN_SITE_URL,
});

/** Pure derivation: main root gets fixed ports, anything else a slot. */
export const resolveWorktreeFromPaths = (
  root: string,
  mainRoot: string | null
): WorktreePorts => {
  if (!mainRoot || root === mainRoot) {
    return mainWorktreePorts();
  }
  const slot = hashPath(root) % SLOT_COUNT;
  const base = SLOT_BASE + slot * SLOT_STRIDE;
  const web = base;
  return {
    namespace: `wt-${(hashPath(`ns:${root}`) % 46_656).toString(36).padStart(3, "0")}`,
    namespaced: true,
    web,
    docs: base + 1,
    convex: base + 10,
    convexSite: base + 11,
    siteUrl: `http://localhost:${web}`,
  };
};

const listWorktrees = async (root: string): Promise<string[] | null> => {
  try {
    const result = await runCommand(
      ["git", "worktree", "list", "--porcelain"],
      { cwd: root, timeoutMs: 10_000 }
    );
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim());
  } catch {
    return null;
  }
};

export const resolveWorktree = async (root: string): Promise<WorktreePorts> => {
  const worktrees = await listWorktrees(root);
  // First entry is the main checkout; without git, assume main (fixed ports).
  return resolveWorktreeFromPaths(root, worktrees?.[0] ?? null);
};
