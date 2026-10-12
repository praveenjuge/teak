/**
 * The dev stack `bun run dev` runs: this checkout's web app on its own port,
 * against the shared cloud dev deployment, signed in through WorkOS staging.
 *
 * Only the push-lease holder runs `convex dev` (scripts/convex-push-lease.ts),
 * so parallel checkouts never overwrite each other's backend. A checkout
 * without the lease runs the web app alone against whatever code is live.
 * `--push` takes the lease over; the previous holder stops pushing at its next
 * heartbeat.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  acquireLease,
  convexRunError,
  describeLease,
  HEARTBEAT_MS,
  headCommit,
  leaseHolder,
  parseRunOutput,
  recordPush,
  releaseLease,
  renewLease,
} from "./convex-push-lease.ts";
import { DEV_DEPLOYMENT_URLS } from "./dev-deployment.ts";
import { loadTargetEnv } from "./env-loader.ts";
import {
  type DevAccount,
  ensureDevAccount,
  isCloudSession,
  readCloudAccountActivity,
  selectStaleCloudAccounts,
} from "./lib/dev-account.ts";
import {
  type StackState,
  stackStatePath,
  stopGroup,
  waitFor,
} from "./lib/stack-state.ts";
import { describeWorkosError } from "./lib/workos-test-session.ts";
import { runCommand } from "./proc.ts";
import { isPortInUse, type WorktreePorts } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");
const CONVEX_DIR = join(ROOT, "packages/convex");
const STATE_PATH = stackStatePath(ROOT);
export const DEV_LOG_PATH = join(dirname(STATE_PATH), "stack.log");
const ACCOUNT_PATH = join(dirname(STATE_PATH), "dev-account.json");
const PUSHED = /Convex functions ready!/;

export interface DevStackOptions {
  /** Also stream the web and backend output to this terminal. */
  echo: boolean;
  ports: WorktreePorts;
  /** Take the push lease even when another checkout holds it. */
  push: boolean;
}

export interface RunningDevStack {
  /** Resolves when the web app or the backend watcher exits on its own. */
  exited: Promise<void>;
  /** What the person should know: pushing or not, sign-in, seeding. */
  notes: string[];
  state: StackState;
  stop: () => Promise<void>;
}

// The account's vault is filled once. Its user.created webhook links it a
// moment after WorkOS creates it, so an unlinked account is retried.
const seedAccount = async (workosUserId: string): Promise<string> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await runCommand(
      [
        "bunx",
        "convex",
        "run",
        "devSeed:seed",
        JSON.stringify({ workosUserId }),
      ],
      { cwd: CONVEX_DIR, timeoutMs: 60_000 }
    );
    if (result.exitCode === 0) {
      return result.stdout.includes('"seeded"')
        ? "its vault is seeded with sample cards"
        : "its vault already has cards";
    }
    if (!result.stderr.includes("no Teak owner")) {
      const reason = result.stderr.includes("TEAK_DEV_DEPLOYMENT")
        ? "TEAK_DEV_DEPLOYMENT=true isn't set on the dev deployment"
        : convexRunError(result.stderr);
      return `seeding skipped (${reason})`;
    }
    await Bun.sleep(3000);
  }
  return "seeding skipped (the account isn't linked yet; it will be on the next start)";
};

class ConvexRunError extends Error {}

const convexRun = async (fn: string, args: Record<string, unknown>) => {
  const result = await runCommand(
    ["bunx", "convex", "run", fn, JSON.stringify(args)],
    { cwd: CONVEX_DIR, timeoutMs: 60_000 }
  );
  if (result.exitCode !== 0) {
    throw new ConvexRunError(
      /Could not find (public )?function/i.test(result.stderr)
        ? `the live backend has no ${fn} yet`
        : `${fn}: ${convexRunError(result.stderr)}`
    );
  }
  return parseRunOutput(result.stdout);
};

interface CloudAccountPage {
  accounts: { email: string; workosUserId: string }[];
  continueCursor: string;
  isDone: boolean;
}

// Each cloud session gets its own dev account, so finished sessions leave
// theirs behind. Delete the ones nobody has signed in to for two weeks through
// the backend's account deletion workflow, which removes the cards, files and
// WorkOS user. The backend refuses anything but cloud session accounts.
const pruneStaleCloudAccounts = async (
  current: DevAccount,
  workos: { apiKey: string; clientId: string }
): Promise<string> => {
  const candidates: CloudAccountPage["accounts"] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const result = (await convexRun("devSeed:listCloudAccounts", {
      cursor,
    })) as CloudAccountPage;
    candidates.push(...result.accounts);
    if (result.isDone) {
      break;
    }
    cursor = result.continueCursor;
  }
  const stale = selectStaleCloudAccounts(
    await readCloudAccountActivity(workos, candidates),
    { current, now: Date.now() }
  );
  for (const account of stale) {
    await convexRun("devSeed:pruneCloudAccount", {
      workosUserId: account.workosUserId,
    });
  }
  return stale.length === 0
    ? "Pruned no stale cloud dev accounts."
    : `Pruning ${stale.length} stale cloud dev account${stale.length === 1 ? "" : "s"}: ${stale.map((account) => account.email).join(", ")}.`;
};

export const startDevStack = async (
  options: DevStackOptions
): Promise<RunningDevStack> => {
  const { ports } = options;
  if (await isPortInUse(ports.web)) {
    throw new Error(
      `Port ${ports.web} is in use. If this checkout's stack is already running, stop it with \`bun run dev --stop\`.`
    );
  }
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const log = createWriteStream(DEV_LOG_PATH);
  const pipe = (child: ChildProcess) => {
    for (const stream of [child.stdout, child.stderr]) {
      stream?.pipe(log, { end: false });
      if (options.echo) {
        stream?.pipe(process.stdout, { end: false });
      }
    }
  };
  const notes: string[] = [];
  const say = (line: string) => {
    console.log(line);
    log.write(`${line}\n`);
  };

  const web = spawn("bun", ["run", "--cwd", "apps/web", "dev"], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, PORT: String(ports.web) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipe(web);

  // Recorded now, not once ready, so a stack whose owner dies while it
  // starts can still be found and stopped (stopOrphanedStack).
  const state: StackState = {
    mode: "dev",
    groups: web.pid ? [web.pid] : [],
    pid: process.pid,
    ports,
    urls: {
      appOrigin: `http://localhost:${ports.web}`,
      convexUrl: DEV_DEPLOYMENT_URLS.convexUrl,
      apiOrigin: DEV_DEPLOYMENT_URLS.convexSiteUrl,
    },
    pushing: false,
    ready: false,
    logPath: DEV_LOG_PATH,
    startedAt: new Date().toISOString(),
  };
  const writeState = () =>
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  writeState();

  let stopping = false;
  let finish: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    finish = resolve;
  });
  web.once("exit", () => {
    if (!stopping) {
      finish();
    }
  });

  const holder = await leaseHolder(ROOT);
  let pusher: ChildProcess | null = null;
  let firstPushDone: () => void = () => undefined;
  const firstPush = new Promise<void>((resolve) => {
    firstPushDone = resolve;
  });
  // Pushing without the lease: the deployed code has no lease functions yet.
  let bootstrapping = false;
  const startPusher = () => {
    const child = spawn("bunx", ["convex", "dev", "--typecheck", "disable"], {
      cwd: CONVEX_DIR,
      detached: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipe(child);
    // The Convex CLI reports each finished push on stderr.
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => {
        if (PUSHED.test(chunk.toString())) {
          firstPushDone();
          headCommit(ROOT).then((commit) => recordPush(ROOT, holder, commit));
        }
      });
    }
    child.once("exit", () => {
      if (pusher === child && !stopping) {
        finish();
      }
    });
    pusher = child;
    state.pushing = true;
    state.groups = [web.pid, child.pid].filter((pid): pid is number =>
      Boolean(pid)
    );
    writeState();
  };
  const stopPusher = async () => {
    const child = pusher;
    if (!child) {
      return;
    }
    pusher = null;
    await stopGroup(child);
    state.pushing = false;
    state.groups = web.pid ? [web.pid] : [];
    writeState();
  };

  const lease = await acquireLease(ROOT, holder, options.push);
  if (lease.status === "ok" && lease.granted) {
    notes.push("This checkout pushes its backend to the dev deployment.");
    startPusher();
  } else if (
    lease.status === "unavailable" &&
    lease.reason === "missing-functions" &&
    options.push
  ) {
    // The first push of the lease itself: nothing can hold it until then.
    notes.push(
      `Pushing this checkout's backend without the lease (${lease.detail}).`
    );
    bootstrapping = true;
    startPusher();
  } else {
    notes.push(
      lease.status === "ok"
        ? `${describeLease(lease.state, holder)}. This checkout runs the web app only; \`bun run dev --push\` pushes its backend instead.`
        : `Not pushing the backend: ${lease.detail}. The web app runs against the live code.`
    );
  }

  const heartbeat = setInterval(async () => {
    if (!pusher) {
      return;
    }
    if (bootstrapping) {
      const taken = await acquireLease(ROOT, holder, true);
      if (taken.status === "ok") {
        bootstrapping = false;
        return;
      }
      if (taken.reason !== "refused") {
        // Not deployed yet, or a passing failure: try again next heartbeat.
        return;
      }
      // The lease exists but the deployment refuses it: stop pushing unfenced.
      const note = `Stopped pushing this checkout's backend: ${taken.detail}.`;
      say(note);
      notes[0] = note;
      bootstrapping = false;
      await stopPusher();
      return;
    }
    const renewed = await renewLease(ROOT, holder);
    if (renewed.status === "ok" && !renewed.granted) {
      const note = `${describeLease(renewed.state, holder)}. Stopped pushing this checkout's backend; run \`bun run dev --push\` to take it back.`;
      say(note);
      notes[0] = note;
      await stopPusher();
    }
  }, HEARTBEAT_MS);

  const stop = async () => {
    stopping = true;
    clearInterval(heartbeat);
    if (pusher) {
      await releaseLease(ROOT, holder);
    }
    await stopPusher();
    await stopGroup(web);
    rmSync(STATE_PATH, { force: true });
  };
  const onSignal = (signal: NodeJS.Signals) => {
    stop().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await waitFor(state.urls.appOrigin, web, 180_000);
  } catch (error) {
    await stop();
    throw error;
  }

  const env = loadTargetEnv("web", "local").values;
  try {
    const account = await ensureDevAccount({
      apiKey: env.get("WORKOS_API_KEY") ?? "",
      clientId: env.get("WORKOS_CLIENT_ID") ?? "",
      namespace: ports.namespace,
      statePath: ACCOUNT_PATH,
    });
    state.account = { email: account.email, password: account.password };
    notes.push(
      `Sign in as ${account.email} / ${account.password} (WorkOS staging); ${await seedAccount(account.workosUserId)}.`
    );
    if (isCloudSession()) {
      // Best-effort and off the startup path: the log says how it went. A
      // checkout that pushes waits for its own backend, which has pruning.
      (pusher ? firstPush : Promise.resolve())
        .then(() =>
          pruneStaleCloudAccounts(account, {
            apiKey: env.get("WORKOS_API_KEY") ?? "",
            clientId: env.get("WORKOS_CLIENT_ID") ?? "",
          })
        )
        .then(say, (error) =>
          say(
            `Couldn't prune stale cloud dev accounts (${error instanceof ConvexRunError ? error.message : describeWorkosError(error)}).`
          )
        );
    }
  } catch (error) {
    notes.push(
      `Couldn't set up this checkout's WorkOS staging account (${describeWorkosError(error)}); sign in with your own.`
    );
  }

  state.notes = notes;
  state.ready = true;
  writeState();
  return { exited, notes, state, stop };
};
