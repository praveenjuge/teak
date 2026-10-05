import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { report: { type: "string" } } });
if (!values.report) {
  throw new Error("Pass a fresh --report path.");
}
const root = resolve(import.meta.dir, "../..");
const workspace = await mkdtemp(join(tmpdir(), "teak-r2-deletion-proof-"));
const server = createServer();
await new Promise<void>((resolveListening) =>
  server.listen(0, "127.0.0.1", resolveListening)
);
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("No local port.");
}
const port = address.port;
await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
const secret = randomUUID();
const worker = Bun.spawn(
  [
    process.execPath,
    "x",
    "wrangler",
    "dev",
    "--config",
    "wrangler.jsonc",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    workspace,
    "--no-types",
    "--show-interactive-dev-session=false",
    "--var",
    `FILES_SIGNING_SECRET:${secret}`,
    "--var",
    "SENTRY_DSN:",
    "--var",
    "SENTRY_ENVIRONMENT:development",
  ],
  {
    cwd: join(root, "apps/files-worker"),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NO_COLOR: "1",
      WRANGLER_SEND_METRICS: "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  }
);
let logs = "";
let ready!: () => void;
const readiness = new Promise<void>((resolveReady) => {
  ready = resolveReady;
});
const collect = async (stream: ReadableStream<Uint8Array>) => {
  for await (const chunk of stream) {
    logs += new TextDecoder().decode(chunk);
    if (logs.includes("Ready on http://")) {
      ready();
    }
  }
};
const collectors = [collect(worker.stdout), collect(worker.stderr)];
let readinessTimer: ReturnType<typeof setTimeout> | undefined;
try {
  await Promise.race([
    readiness,
    worker.exited.then((code) => {
      throw new Error(`Local Worker exited before readiness: ${code}`);
    }),
    new Promise<never>((_, reject) => {
      readinessTimer = setTimeout(
        () => reject(new Error("Local Worker readiness deadline exceeded.")),
        60_000
      );
    }),
  ]);
  clearTimeout(readinessTimer);
  const health = await fetch(`http://127.0.0.1:${port}/__health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) {
    throw new Error(`Local Worker health failed: ${health.status}`);
  }
  const harness = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      join(root, "scripts/workos-migration/r2-deletion-readiness.ts"),
      "--environment",
      "development",
      "--execute",
      "--report",
      resolve(values.report),
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        FILES_BASE: `http://127.0.0.1:${port}`,
        FILES_SIGNING_SECRET: secret,
        R2_KEY_PREFIX: "dev/",
      },
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  if ((await harness.exited) !== 0) {
    throw new Error("Local R2 readiness proof failed.");
  }
} finally {
  clearTimeout(readinessTimer);
  worker.kill();
  await worker.exited;
  await Promise.all(collectors);
  // Generated test signing value is disposable and omitted from saved logs.
  await writeFile(
    `${resolve(values.report)}.runtime.log`,
    logs.replaceAll(secret, "[disposable test value]"),
    { flag: "wx", mode: 0o600 }
  );
}
