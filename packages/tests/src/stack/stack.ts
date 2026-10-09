/**
 * One checkout's local stack: the WorkOS emulator, a local Convex backend and
 * the web app, on the checkout's own ports. `bun run dev` runs it with the dev
 * account and seed data and keeps pushing backend changes; the E2E suite runs
 * it bare and pushes once. `bun run setup` wires the deployment first.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";
import { isPortInUse } from "../../../../scripts/worktree-env.ts";
import {
  DEV_USER,
  EMULATOR_API_KEY,
  EMULATOR_WEBHOOK_SECRET,
  STACK_STATE_PATH,
  type StackPorts,
  type StackState,
  stackUrls,
} from "./config";
import { startEmulator } from "./emulator";

const ROOT = join(import.meta.dir, "../../../..");
const CONVEX_DIR = join(ROOT, "packages/convex");
export const STACK_LOG_PATH = join(dirname(STACK_STATE_PATH), "stack.log");

export interface StackOptions {
  /** Also stream the backend and web output to this terminal. */
  echo: boolean;
  /**
   * Sign in through the local WorkOS emulator. Off for a checkout wired to
   * WorkOS staging (`bun run dev --workos staging`).
   */
  emulator: boolean;
  /** The deployment is a local backend, so it binds this checkout's ports. */
  localBackend: boolean;
  ports: StackPorts;
  /** Add the dev account and seed data; needs the emulator. */
  seed: boolean;
  /** Push backend changes as files change, instead of pushing once. */
  watch: boolean;
}

export interface RunningStack {
  /** Resolves when the backend or web process exits on its own. */
  exited: Promise<void>;
  stop: () => Promise<void>;
  urls: ReturnType<typeof stackUrls>;
}

const waitFor = async (url: string, child: ChildProcess, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  // A server that answers but keeps refusing (a 4xx) won't recover by waiting.
  let refusals = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The stack exited before ${url} came up`);
    }
    try {
      // The web app redirects to sign-in, so follow redirects and require the
      // final page (or the API health check) to succeed. Only the stack's own
      // loopback URLs are polled.
      // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) {
        return;
      }
      refusals = response.status < 500 ? refusals + 1 : 0;
      if (refusals >= 15) {
        throw new Error(
          `${url} keeps answering ${response.status}: ${body.slice(0, 200).trim()}`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(url)) {
        throw error;
      }
      // Not listening yet.
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
};

// A freshly pushed backend loads each module on its first call, which can
// outlast the 1s query limit on a busy machine. Load the modules the web app
// queries first, without auth; their answers don't matter.
const warmBackend = async (convexUrl: string) => {
  const client = new ConvexHttpClient(convexUrl);
  const calls = [
    () => client.query(api.auth.getAuthMode, {}),
    () => client.query(api.auth.getCardCreationStatus, {}),
    () => client.query(api.auth.getAuthUser, {}),
    () =>
      client.query(api.cards.searchCardsPaginated, {
        paginationOpts: { cursor: null, numItems: 1 },
      }),
  ];
  for (let round = 0; round < 2; round += 1) {
    await Promise.allSettled(calls.map((call) => call()));
  }
};

const run = (command: string[], cwd: string) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

// The emulator never sends webhooks for users it was seeded with, so the
// stack sends the dev account's user.created event itself, signed like the
// emulator would sign it, to the backend's real webhook. Then the backend
// fills the account's empty vault.
const seedDevAccount = async (urls: ReturnType<typeof stackUrls>) => {
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(
    `${urls.emulatorOrigin}/user_management/users/${DEV_USER.id}`,
    { headers: { Authorization: `Bearer ${EMULATOR_API_KEY}` } }
  );
  if (!response.ok) {
    throw new Error(`The emulator has no dev account (${response.status})`);
  }
  const user = (await response.json()) as { created_at?: string };
  const payload = JSON.stringify({
    id: "event_01TEAKDEVSEED0000000000000",
    event: "user.created",
    data: user,
    created_at: user.created_at ?? new Date().toISOString(),
  });
  const timestamp = Date.now();
  const signature = createHmac("sha256", EMULATOR_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const delivered = await fetch(`${urls.apiOrigin}/workos/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "WorkOS-Signature": `t=${timestamp}, v1=${signature}`,
    },
    body: payload,
  });
  const outcome = await delivered.text();
  if (!(delivered.ok && outcome === "OK")) {
    throw new Error(
      `The backend did not accept the dev account (${delivered.status} ${outcome})`
    );
  }
  const result = await run(
    [
      "bunx",
      "convex",
      "run",
      "devSeed:seed",
      JSON.stringify({ workosUserId: DEV_USER.id }),
    ],
    CONVEX_DIR
  );
  if (result.code !== 0) {
    throw new Error(
      `Seeding failed: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`
    );
  }
};

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
  try {
    process.kill(-(child.pid ?? 0), signal);
  } catch {
    // Already gone.
  }
};

// `convex dev` runs the web server in its own process group and stops it
// only on SIGINT, so interrupt first and force-stop whatever remains.
const stopGroup = async (child: ChildProcess) => {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalGroup(child, "SIGINT");
  await Promise.race([exited, Bun.sleep(15_000)]);
  signalGroup(child, "SIGKILL");
};

export const startStack = async (
  options: StackOptions
): Promise<RunningStack> => {
  const { ports } = options;
  const urls = stackUrls(ports);
  const seed = options.seed && options.emulator;
  const busy: number[] = [];
  for (const port of [
    ports.web,
    ...(options.localBackend ? [ports.convex, ports.convexSite] : []),
    ...(options.emulator ? [ports.emulator, ports.emulator + 1] : []),
  ]) {
    if (await isPortInUse(port)) {
      busy.push(port);
    }
  }
  if (busy.length > 0) {
    throw new Error(
      `Port ${busy.join(", ")} is in use. If this checkout's stack is already running, stop it with \`bun run dev --stop\`.`
    );
  }

  mkdirSync(dirname(STACK_STATE_PATH), { recursive: true });
  const emulator = options.emulator
    ? await startEmulator(ports, { devUser: seed })
    : null;
  // Setup already pushed once. The web server runs alongside the backend so
  // both stop together; the Convex CLI passes PORT through to it.
  const convex = spawn(
    "bunx",
    [
      "convex",
      "dev",
      ...(options.localBackend
        ? [
            "--local-cloud-port",
            String(ports.convex),
            "--local-site-port",
            String(ports.convexSite),
          ]
        : []),
      "--typecheck",
      "disable",
      ...(options.watch ? [] : ["--once", "--codegen", "disable"]),
      "--start",
      "bun run --cwd ../../apps/web dev",
    ],
    {
      cwd: CONVEX_DIR,
      detached: true,
      env: {
        ...process.env,
        // The emulator only works with a local anonymous backend.
        ...(options.emulator ? { CONVEX_AGENT_MODE: "anonymous" } : {}),
        PORT: String(ports.web),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const log = createWriteStream(STACK_LOG_PATH);
  for (const stream of [convex.stdout, convex.stderr]) {
    stream?.pipe(log);
    if (options.echo) {
      stream?.pipe(process.stdout);
    }
  }

  // Recorded now, not once ready, so a stack whose owner dies while it
  // starts can still be found and stopped (stopOrphanedStack).
  const state: StackState = {
    group: convex.pid ?? 0,
    pid: process.pid,
    ports,
    urls,
    ready: false,
    seeded: seed,
    logPath: STACK_LOG_PATH,
    startedAt: new Date().toISOString(),
  };
  const writeState = () =>
    writeFileSync(STACK_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  writeState();

  let stopping = false;
  const stop = async () => {
    stopping = true;
    await stopGroup(convex);
    await emulator?.close();
    rmSync(STACK_STATE_PATH, { force: true });
  };
  // Ctrl-C or `bun run dev --stop` at any point, starting or running, stops
  // the backend and web app too; they run in their own process group.
  const onSignal = (signal: NodeJS.Signals) => {
    stop().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const exited = new Promise<void>((resolve) => {
    convex.once("exit", () => {
      if (!stopping) {
        resolve();
      }
    });
  });

  try {
    if (options.localBackend) {
      await waitFor(`${urls.apiOrigin}/healthz`, convex, 180_000);
    }
    await waitFor(urls.appOrigin, convex, 180_000);
    if (options.localBackend) {
      await warmBackend(urls.convexUrl);
    }
    if (seed) {
      await seedDevAccount(urls);
    }
  } catch (error) {
    await stop();
    throw error;
  }

  state.ready = true;
  writeState();
  return { exited, stop, urls };
};
