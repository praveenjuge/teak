import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";
import {
  recordStartingStack,
  type StackState,
  type StackUrls,
  stackStatePath,
  stopGroup,
  waitFor,
} from "../../../../scripts/lib/stack-state.ts";
import {
  isPortInUse,
  type WorktreePorts,
} from "../../../../scripts/worktree-env.ts";
import { localBackendEnv } from "./backend";
import { emulatorWebEnv, stackUrls } from "./config";
import { startEmulator } from "./emulator";
import { startFilesWorker } from "./filesWorker";

const ROOT = join(import.meta.dir, "../../../..");
const CONVEX_DIR = join(ROOT, "packages/convex");
const STATE_PATH = stackStatePath(ROOT);
export const STACK_LOG_PATH = join(dirname(STATE_PATH), "stack.log");

export interface StackOptions {
  /**
   * Runs once the stack answers, before it is recorded as ready: the sign-in
   * and notes it returns are what `bun run dev --status` prints.
   */
  beforeReady?: (
    urls: StackUrls
  ) => Promise<Pick<StackState, "account" | "notes">>;
  echo: boolean;
  env?: NodeJS.ProcessEnv;
  ports: WorktreePorts;
  /**
   * Keep pushing the backend as its files change, for `bun run dev --local`.
   * The suite pushes it once.
   */
  watch?: boolean;
}

export interface RunningStack {
  exited: Promise<void>;
  stop: () => Promise<void>;
  urls: StackUrls;
}

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
    ports.emulatorUpstream,
    ports.filesWorker,
    ports.filesWorkerInspector,
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

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const emulator = await startEmulator(ports);
  const env = options.env ?? localBackendEnv();
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
      ...(options.watch ? [] : ["--once"]),
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
        PORT: String(ports.web),
        ...emulatorWebEnv(ports),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const log = createWriteStream(STACK_LOG_PATH);
  const filesWorker = startFilesWorker(ports, log, env);
  for (const stream of [convex.stdout, convex.stderr]) {
    stream?.pipe(log);
    if (options.echo) {
      stream?.pipe(process.stdout);
    }
  }

  const { save: saveState, state } = recordStartingStack(ROOT, {
    groups: [convex.pid, filesWorker.child.pid].filter(
      (pid): pid is number => pid !== undefined
    ),
    pid: process.pid,
    mode: "e2e",
    ports,
    urls,
    logPath: STACK_LOG_PATH,
  });

  let stopping = false;
  const stop = async () => {
    stopping = true;
    await Promise.all([stopGroup(convex), stopGroup(filesWorker.child)]);
    await emulator.close();
    rmSync(STATE_PATH, { force: true });
  };
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
    await waitFor(`${filesWorker.origin}/__health`, filesWorker.child, 180_000);
    await waitFor(`${urls.apiOrigin}/healthz`, convex, 180_000);
    await waitFor(urls.appOrigin, convex, 180_000);
    await warmBackend(urls.convexUrl);
    Object.assign(state, await options.beforeReady?.(urls));
  } catch (error) {
    await stop();
    throw error;
  }

  state.ready = true;
  saveState();
  return { exited, stop, urls };
};
