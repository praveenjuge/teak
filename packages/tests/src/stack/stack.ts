/**
 * One checkout's E2E stack: the WorkOS emulator, a local Convex backend and
 * the web app, on the checkout's own ports. The backend is pushed once, and
 * the web app gets its emulator settings as process environment, so the dev
 * wiring in apps/web/.env.local stays as it is. `bun run setup --target e2e`
 * wires the local backend first.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";
import { isPortInUse } from "../../../../scripts/worktree-env.ts";
import {
  emulatorWebEnv,
  STACK_STATE_PATH,
  type StackPorts,
  type StackState,
  type StackUrls,
  stackUrls,
} from "./config";
import { startEmulator } from "./emulator";

const ROOT = join(import.meta.dir, "../../../..");
const CONVEX_DIR = join(ROOT, "packages/convex");
export const STACK_LOG_PATH = join(dirname(STACK_STATE_PATH), "stack.log");

export interface StackOptions {
  /** Also stream the backend and web output to this terminal. */
  echo: boolean;
  ports: StackPorts;
}

export interface RunningStack {
  /** Resolves when the backend or web process exits on its own. */
  exited: Promise<void>;
  stop: () => Promise<void>;
  urls: StackUrls;
}

export const waitFor = async (
  url: string,
  child: ChildProcess,
  timeoutMs: number
) => {
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

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
  try {
    process.kill(-(child.pid ?? 0), signal);
  } catch {
    // Already gone.
  }
};

// `convex dev` runs the web server in its own process group and stops it
// only on SIGINT, so interrupt first and force-stop whatever remains.
export const stopGroup = async (child: ChildProcess) => {
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
  const busy: number[] = [];
  for (const port of [
    ports.web,
    ports.convex,
    ports.convexSite,
    ports.emulator,
    ports.emulator + 1,
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
  const emulator = await startEmulator(ports);
  // Setup already wired the local backend. The web server runs alongside it
  // so both stop together; the Convex CLI passes the environment through.
  const { CONVEX_DEPLOY_KEY: _cloudKey, ...env } = process.env;
  const convex = spawn(
    "bunx",
    [
      "convex",
      "dev",
      "--local-cloud-port",
      String(ports.convex),
      "--local-site-port",
      String(ports.convexSite),
      "--typecheck",
      "disable",
      "--once",
      "--codegen",
      "disable",
      "--start",
      "bun run --cwd ../../apps/web dev",
    ],
    {
      cwd: CONVEX_DIR,
      detached: true,
      env: {
        ...env,
        CONVEX_AGENT_MODE: "anonymous",
        PORT: String(ports.web),
        ...emulatorWebEnv(ports),
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
    groups: convex.pid ? [convex.pid] : [],
    pid: process.pid,
    mode: "e2e",
    ports,
    urls,
    ready: false,
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
    await emulator.close();
    rmSync(STACK_STATE_PATH, { force: true });
  };
  // Ctrl-C at any point, starting or running, stops the backend and web app
  // too; they run in their own process group.
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
    await waitFor(`${urls.apiOrigin}/healthz`, convex, 180_000);
    await waitFor(urls.appOrigin, convex, 180_000);
    await warmBackend(urls.convexUrl);
  } catch (error) {
    await stop();
    throw error;
  }

  state.ready = true;
  writeState();
  return { exited, stop, urls };
};
