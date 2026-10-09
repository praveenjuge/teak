// The local stack: the WorkOS emulator, a local Convex backend and the web
// app. Ports belong to the checkout (scripts/worktree-env.ts), so every
// worktree runs its own stack. Every WorkOS value here is test-only and exists
// only in the emulator's memory, so it is safe to commit.

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

// authkit-nextjs reads these to reach a WorkOS API other than api.workos.com.
export const emulatorWebEnv = (ports: StackPorts) => ({
  WORKOS_API_HOSTNAME: "localhost",
  WORKOS_API_PORT: String(ports.emulator),
  WORKOS_API_HTTPS: "false",
});

// The account `bun run dev` signs in with. The emulator forgets everything on
// restart; the pinned ID brings back the same WorkOS user, so it keeps its
// Teak vault.
export const DEV_USER = {
  id: "user_01TEAKDEVSEED0000000000000",
  email: "dev@example.org",
  password: "teak-dev-Password-1!",
  first_name: "Teak",
  last_name: "Developer",
  email_verified: true,
} as const;

export const emulatorSeed = (
  ports: StackPorts,
  options: { devUser: boolean }
) => ({
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
  ...(options.devUser ? { users: [{ ...DEV_USER }] } : {}),
});

// A running stack records itself here so agents, scripts and the E2E suite
// can find its URLs. It is removed when the stack stops. Playwright loads
// this file under Node, so the path comes from import.meta.url.
export const STACK_STATE_PATH = fileURLToPath(
  new URL("../../../../.agents/.state/stack.json", import.meta.url)
);

export interface StackState {
  /** Process group of the backend and web app (the `convex dev` process). */
  group: number;
  logPath: string;
  /** The process that owns the stack; the stack stops when it does. */
  pid: number;
  ports: StackPorts;
  /** False while the stack is still starting. */
  ready: boolean;
  seeded: boolean;
  startedAt: string;
  urls: ReturnType<typeof stackUrls>;
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
// is never mistaken for the stack.
const commands = (): { command: string; pgid: number; pid: number }[] => {
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
    return [];
  }
};

const STACK_OWNERS = ["scripts/dev.ts", "run-local-suite.ts"];
const STACK_MEMBERS = ["convex", "next"];

/** The recorded owner is alive and is still a Teak stack process. */
export const isStackRunning = (state: StackState): boolean =>
  isProcessAlive(state.pid) &&
  commands().some(
    (entry) =>
      entry.pid === state.pid &&
      STACK_OWNERS.some((owner) => entry.command.includes(owner))
  );

// The backend and web app's process group, if any of its members is still a
// Convex or Next.js process.
const groupAlive = (group: number): boolean =>
  validPid(group) &&
  exists(-group) &&
  commands().some(
    (entry) =>
      entry.pgid === group &&
      STACK_MEMBERS.some((member) => entry.command.includes(member))
  );

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
  if (groupAlive(state.group)) {
    process.kill(-state.group, "SIGINT");
    const deadline = Date.now() + 15_000;
    while (groupAlive(state.group) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (groupAlive(state.group)) {
      process.kill(-state.group, "SIGKILL");
    }
  }
  rmSync(STACK_STATE_PATH, { force: true });
  return true;
};
