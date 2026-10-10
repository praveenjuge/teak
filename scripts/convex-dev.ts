#!/usr/bin/env bun
/**
 * `convex dev` for Turbo targets (`bun run dev extension`, `--all`), against
 * the shared cloud dev deployment. Like the web stack, it pushes only while it
 * holds the push lease (scripts/convex-push-lease.ts); otherwise the surface
 * runs against the live backend code.
 */

import { join } from "node:path";
import {
  isStackRunning,
  readStackState,
} from "../packages/tests/src/stack/config.ts";
import {
  acquireLease,
  describeLease,
  HEARTBEAT_MS,
  headCommit,
  leaseHolder,
  recordPush,
  releaseLease,
  renewLease,
} from "./convex-push-lease.ts";

const ROOT = join(import.meta.dir, "..");
const idle = () => new Promise(() => undefined);

// `bun run dev` already runs this checkout's web stack, which pushes the
// backend when it holds the lease, so a surface started beside it shares it.
const stack = readStackState();
if (stack && isStackRunning(stack)) {
  console.log(
    `Using this checkout's running stack and the backend at ${stack.urls.convexUrl}.`
  );
  await idle();
}

const holder = await leaseHolder(ROOT);
const lease = await acquireLease(ROOT, holder, false);
if (!(lease.status === "ok" && lease.granted)) {
  console.log(
    lease.status === "ok"
      ? `${describeLease(lease.state, holder)}; not pushing this checkout's backend.`
      : `Not pushing the backend: ${lease.detail}.`
  );
  await idle();
}

const child = Bun.spawn(["bunx", "convex", "dev", ...process.argv.slice(2)], {
  cwd: join(ROOT, "packages/convex"),
  stdio: ["inherit", "pipe", "pipe"],
});
// Echo the watcher's output and record each push for `bun run dev --status`;
// the Convex CLI reports a finished push on stderr.
const echo = async (
  stream: ReadableStream<Uint8Array>,
  out: NodeJS.WriteStream
) => {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk);
    out.write(text);
    if (text.includes("Convex functions ready!")) {
      await recordPush(ROOT, holder, await headCommit(ROOT));
    }
  }
};
echo(child.stdout, process.stdout);
echo(child.stderr, process.stderr);
let lost = false;
const heartbeat = setInterval(async () => {
  const renewed = await renewLease(ROOT, holder);
  if (renewed.status === "ok" && !renewed.granted) {
    console.log(
      `${describeLease(renewed.state, holder)}; stopped pushing this checkout's backend.`
    );
    lost = true;
    child.kill("SIGINT");
  }
}, HEARTBEAT_MS);
const release = () => {
  clearInterval(heartbeat);
  if (lost) {
    // The watcher already stopped and the lease belongs to someone else.
    process.exit(130);
  }
  child.kill("SIGINT");
};
process.once("SIGINT", release);
process.once("SIGTERM", release);
process.exitCode = await child.exited;
clearInterval(heartbeat);
if (lost) {
  // Keep the Turbo task alive: the other surfaces still run.
  await idle();
}
await releaseLease(ROOT, holder);
