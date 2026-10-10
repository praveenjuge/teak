// The E2E stack: the WorkOS emulator, a local Convex backend and the web app.
// Ports belong to the checkout (scripts/worktree-env.ts), so every worktree
// runs its own stack. Every WorkOS value here is test-only and exists only in
// the emulator's memory, so it is safe to commit. `bun run dev` records its
// own stack (scripts/dev-stack.ts) in the same state file.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface StackPorts {
  convex: number;
  convexSite: number;
  emulator: number;
  web: number;
}

/** The main checkout's fixed ports; linked worktrees lease their own. */
export const MAIN_STACK_PORTS: StackPorts = {
  web: 3000,
  convex: 3210,
  convexSite: 3211,
  emulator: 4100,
};

export const EMULATOR_CLIENT_ID = "client_01TEAKE2EEMULATOR";
export const EMULATOR_API_KEY = "sk_test_default";
export const EMULATOR_ENVIRONMENT_ID = "environment_01TEAKE2EEMULATOR";
export const EMULATOR_WEBHOOK_SECRET = "whsec_teak_e2e_emulator_only";
// Seals the E2E web app's AuthKit sessions. Test-only, like the values above.
export const EMULATOR_COOKIE_PASSWORD =
  "teak-e2e-emulator-cookie-password-0001";

export interface StackUrls {
  apiOrigin: string;
  appOrigin: string;
  convexUrl: string;
  /** Only the E2E stack runs the WorkOS emulator. */
  emulatorOrigin?: string;
}

export const stackUrls = (ports: StackPorts) => ({
  appOrigin: `http://localhost:${ports.web}`,
  convexUrl: `http://127.0.0.1:${ports.convex}`,
  apiOrigin: `http://127.0.0.1:${ports.convexSite}`,
  emulatorOrigin: `http://localhost:${ports.emulator}`,
});

// Values the local Convex deployment needs to trust emulator sessions and
// receive its signed webhooks.
export const emulatorDeploymentVars = (ports: StackPorts) => ({
  WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
  WORKOS_API_KEY: EMULATOR_API_KEY,
  WORKOS_API_BASE_URL: stackUrls(ports).emulatorOrigin,
  WORKOS_ENVIRONMENT_ID: EMULATOR_ENVIRONMENT_ID,
  WORKOS_WEBHOOK_SECRET: EMULATOR_WEBHOOK_SECRET,
});

// The E2E web app's settings. The stack passes them as process environment,
// which Next.js prefers over apps/web/.env.local, so the E2E stack never
// rewrites the dev wiring in that file. authkit-nextjs reads WORKOS_API_* to
// reach a WorkOS API other than api.workos.com.
export const emulatorWebEnv = (ports: StackPorts) => {
  const urls = stackUrls(ports);
  return {
    NEXT_PUBLIC_CONVEX_URL: urls.convexUrl,
    NEXT_PUBLIC_CONVEX_SITE_URL: urls.apiOrigin,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${urls.appOrigin}/callback`,
    WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
    WORKOS_API_KEY: EMULATOR_API_KEY,
    WORKOS_COOKIE_PASSWORD: EMULATOR_COOKIE_PASSWORD,
    WORKOS_API_HOSTNAME: "localhost",
    WORKOS_API_PORT: String(ports.emulator),
    WORKOS_API_HTTPS: "false",
  };
};

export const emulatorSeed = (ports: StackPorts) => ({
  // Teak's WorkOS environment adds the verification claims to session tokens
  // with a JWT template, and the backend requires `email_verified: true`.
  jwtTemplate: {
    content:
      '{"email": {{ user.email }}, "email_verified": {{ user.email_verified }}}',
  },
  webhookEndpoints: [
    {
      endpoint_url: `${stackUrls(ports).apiOrigin}/workos/webhook`,
      secret: EMULATOR_WEBHOOK_SECRET,
      events: ["user.created", "user.updated", "user.deleted"],
    },
  ],
});

// A running stack records itself here so agents, scripts and the E2E suite
// can find its URLs. It is removed when the stack stops. Playwright loads
// this file under Node, so the path comes from import.meta.url.
export const STACK_STATE_PATH = fileURLToPath(
  new URL("../../../../.agents/.state/stack.json", import.meta.url)
);

export interface StackState {
  /** The dev stack's sign-in account (scripts/dev-stack.ts). */
  account?: { email: string; password: string };
  /** Process groups of the backend and web app. */
  groups: number[];
  logPath: string;
  /** `dev` (the shared cloud deployment) or `e2e` (local, emulator). */
  mode: "dev" | "e2e";
  /** What the dev stack told the person: pushing or not, sign-in, seeding. */
  notes?: string[];
  /** The process that owns the stack; the stack stops when it does. */
  pid: number;
  ports: StackPorts;
  /** Whether this stack pushes backend code (the dev push lease). */
  pushing?: boolean;
  /** False while the stack is still starting. */
  ready: boolean;
  startedAt: string;
  urls: StackUrls;
}

export const readStackState = (): StackState | null => {
  if (!existsSync(STACK_STATE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(STACK_STATE_PATH, "utf-8")) as StackState;
  } catch {
    return null;
  }
};

const validPid = (pid: unknown): pid is number =>
  typeof pid === "number" && Number.isInteger(pid) && pid > 1;

// Signal 0 checks existence. Only ESRCH proves the target is gone; EPERM
// means it exists but belongs to someone else.
const exists = (target: number): boolean => {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

export const isProcessAlive = (pid: number): boolean =>
  validPid(pid) && exists(pid);

// Command lines of live processes, so a PID reused after a crash or reboot
// is never mistaken for the stack. Null when `ps` can't run (an image
// without procps), which proves nothing either way.
const commands = ():
  | { command: string; pgid: number; pid: number }[]
  | null => {
  try {
    return execFileSync("ps", ["-axo", "pid=,pgid=,command="], {
      encoding: "utf-8",
    })
      .split("\n")
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return match
          ? [
              {
                pid: Number(match[1]),
                pgid: Number(match[2]),
                command: match[3],
              },
            ]
          : [];
      });
  } catch {
    return null;
  }
};

const STACK_OWNERS = ["scripts/dev.ts", "run-local-suite.ts"];
// Leaves `group`, the single group older stacks recorded, readable.
const groupsOf = (state: StackState & { group?: number }): number[] =>
  state.groups ?? (state.group ? [state.group] : []);
const STACK_MEMBERS = ["convex", "next"];

/**
 * The recorded owner is alive and is still a Teak stack process. Without
 * `ps` only liveness can be checked, so a live PID counts as the stack and
 * its state is never treated as orphaned.
 */
export const isStackRunning = (state: StackState): boolean => {
  if (!isProcessAlive(state.pid)) {
    return false;
  }
  const list = commands();
  return (
    list === null ||
    list.some(
      (entry) =>
        entry.pid === state.pid &&
        STACK_OWNERS.some((owner) => entry.command.includes(owner))
    )
  );
};

// The backend and web app's process group, if any of its members is still a
// Convex or Next.js process. Without `ps` membership can't be proven, and a
// group ID may have been reused, so the group is never signaled.
const groupAlive = (group: number): boolean => {
  if (!(validPid(group) && exists(-group))) {
    return false;
  }
  const list = commands();
  return (
    list?.some(
      (entry) =>
        entry.pgid === group &&
        STACK_MEMBERS.some((member) => entry.command.includes(member))
    ) ?? false
  );
};

// A group that went away, or belongs to someone else, is left alone.
const signalGroup = (group: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-group, signal);
  } catch {
    // Gone, or not ours to signal.
  }
};

/**
 * Stop a stack whose owner died without cleaning up (killed with SIGKILL, or
 * a crash), so its backend and web server don't hold the ports forever.
 * Returns true when it stopped one.
 */
export const stopOrphanedStack = async (): Promise<boolean> => {
  const state = readStackState();
  if (!state || isStackRunning(state)) {
    return false;
  }
  for (const group of groupsOf(state)) {
    if (!groupAlive(group)) {
      continue;
    }
    signalGroup(group, "SIGINT");
    const deadline = Date.now() + 15_000;
    while (groupAlive(group) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (groupAlive(group)) {
      signalGroup(group, "SIGKILL");
    }
  }
  rmSync(STACK_STATE_PATH, { force: true });
  return true;
};
