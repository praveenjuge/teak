/**
 * Ports for this checkout's local stack.
 *
 * The main checkout keeps the fixed ports. Each linked worktree leases a slot
 * of ports and keeps it until the worktree is removed. Leases live in the
 * repository's shared git directory, so two worktrees never get the same slot
 * even when one of them isn't running.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { join, resolve } from "node:path";
import { runCommand } from "./proc.ts";

export interface WorktreePorts {
  convex: number;
  convexSite: number;
  docs: number;
  /** WorkOS emulator; its upstream listens on the next port. */
  emulator: number;
  /** The browser extension's WXT dev server. */
  extension: number;
  /** "main" for the primary checkout, "wt-<slot>" for a linked worktree. */
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
  emulator: 4100,
  extension: 3003,
} as const;

export const MAIN_SITE_URL = "http://localhost:3000";

const SLOT_COUNT = 40;
const SLOT_STRIDE = 100;
const SLOT_BASE = 4000;

/** Every port a stack binds, including the emulator's upstream. */
export const stackPorts = (ports: WorktreePorts): number[] => [
  ports.web,
  ports.docs,
  ports.extension,
  ports.convex,
  ports.convexSite,
  ports.emulator,
  ports.emulator + 1,
];

// Slots that would reuse a main checkout port, or a port macOS keeps open for
// the AirPlay Receiver (5000 and 7000), are never leased.
const RESERVED_PORTS = new Set([
  ...stackPorts({
    ...MAIN_PORTS,
    namespace: "main",
    namespaced: false,
    siteUrl: MAIN_SITE_URL,
  }),
  5000,
  7000,
]);

/** FNV-1a 32-bit hash: a worktree's first-choice slot. */
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
  ...MAIN_PORTS,
  siteUrl: MAIN_SITE_URL,
});

export const slotPorts = (slot: number): WorktreePorts => {
  const web = SLOT_BASE + slot * SLOT_STRIDE;
  return {
    namespace: `wt-${slot}`,
    namespaced: true,
    web,
    docs: web + 1,
    extension: web + 2,
    convex: web + 10,
    convexSite: web + 11,
    emulator: web + 20,
    siteUrl: `http://localhost:${web}`,
  };
};

export const isUsableSlot = (slot: number): boolean =>
  Number.isInteger(slot) &&
  slot >= 0 &&
  slot < SLOT_COUNT &&
  stackPorts(slotPorts(slot)).every((port) => !RESERVED_PORTS.has(port));

/**
 * Keep an existing lease; otherwise take the first usable slot, starting from
 * the path's hash, that no other worktree leases and whose ports are free.
 */
export const pickSlot = async (
  root: string,
  leases: Record<string, number>,
  isBusy: (slot: number) => Promise<boolean>
): Promise<number> => {
  const existing = leases[root];
  if (existing !== undefined && isUsableSlot(existing)) {
    return existing;
  }
  const taken = new Set(
    Object.entries(leases).flatMap(([path, slot]) =>
      path === root ? [] : [slot]
    )
  );
  const start = hashPath(root) % SLOT_COUNT;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = (start + i) % SLOT_COUNT;
    if (isUsableSlot(slot) && !taken.has(slot) && !(await isBusy(slot))) {
      return slot;
    }
  }
  throw new Error(
    `All ${SLOT_COUNT} worktree port slots are leased or busy. Remove worktrees you no longer need (git worktree remove) and re-run.`
  );
};

const accepts = (port: number, host: string): Promise<boolean> =>
  new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

const bindFails = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(true));
    server.once("listening", () => server.close(() => done(false)));
    server.listen(port);
  });

/**
 * True when anything listens on the port. Both checks are needed: a wildcard
 * listener on macOS doesn't block binding 127.0.0.1, and a loopback-only
 * listener may not answer on the other address family.
 */
export const isPortInUse = async (port: number): Promise<boolean> =>
  (await accepts(port, "127.0.0.1")) ||
  (await accepts(port, "::1")) ||
  (await bindFails(port));

const anyPortInUse = async (ports: number[]): Promise<boolean> => {
  for (const port of ports) {
    if (await isPortInUse(port)) {
      return true;
    }
  }
  return false;
};

const git = async (root: string, args: string[]): Promise<string | null> => {
  try {
    const result = await runCommand(["git", ...args], {
      cwd: root,
      timeoutMs: 10_000,
    });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
};

const LEASE_FILE = "teak-worktree-slots.json";

const readLeases = (path: string): Record<string, number> => {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === "string" && Number.isInteger(value)
      )
    ) as Record<string, number>;
  } catch {
    return {};
  }
};

// One writer at a time: mkdir is atomic, and a lock older than 30 seconds is
// left over from a crashed run.
const withLock = async <T>(dir: string, work: () => Promise<T>): Promise<T> => {
  const lock = join(dir, "teak-worktree-slots.lock");
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${lock}`);
      }
      await Bun.sleep(100);
    }
  }
  try {
    return await work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
};

/** Lease (or reuse) this worktree's slot, dropping leases of removed worktrees. */
const leaseSlot = async (root: string, commonDir: string): Promise<number> =>
  await withLock(commonDir, async () => {
    const file = join(commonDir, LEASE_FILE);
    const leases = Object.fromEntries(
      Object.entries(readLeases(file)).filter(([path]) => existsSync(path))
    );
    const slot = await pickSlot(root, leases, (candidate) =>
      anyPortInUse(stackPorts(slotPorts(candidate)))
    );
    leases[root] = slot;
    writeFileSync(file, `${JSON.stringify(leases, null, 2)}\n`);
    return slot;
  });

export const resolveWorktree = async (root: string): Promise<WorktreePorts> => {
  const list = await git(root, ["worktree", "list", "--porcelain"]);
  // The first entry is the main checkout; without git, assume main.
  const main = list
    ?.split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  if (!main || resolve(main) === resolve(root)) {
    return mainWorktreePorts();
  }
  const commonDir = await git(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!commonDir) {
    throw new Error(
      "Could not find the shared git directory for this worktree"
    );
  }
  return slotPorts(await leaseSlot(resolve(root), commonDir));
};
