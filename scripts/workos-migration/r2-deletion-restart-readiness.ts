import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  callFilesWorkerJson,
  putObjectViaFilesWorker,
} from "@teak/convex/storage/filesWorkerClient";

// Local-only boundary fault: R2 PUT commits but its completion never reaches
// the production gate. Kill the real workerd process, then reopen the same
// SQLite state. This proves persistence of uncertainty, not remote R2 ordering.
const { values } = parseArgs({ options: { report: { type: "string" } } });
if (!values.report) {
  throw new Error("Pass a fresh --report path.");
}
const reportPath = resolve(values.report);
if (existsSync(reportPath) || existsSync(`${reportPath}.runtime.log`)) {
  throw new Error("Report path already exists.");
}
const root = resolve(import.meta.dir, "../..");
const workspace = await mkdtemp(join(tmpdir(), "teak-r2-restart-proof-"));
const portServer = createServer();
await new Promise<void>((ready) => portServer.listen(0, "127.0.0.1", ready));
const address = portServer.address();
if (!address || typeof address === "string") {
  throw new Error("No local port.");
}
const port = address.port;
await new Promise<void>((closed) => portServer.close(() => closed()));
const secret = randomUUID();
const key = `dev/users/workos-deletion-readiness/${randomUUID()}/unknown.txt`;
const config = join(workspace, "wrangler.json");
const entry = join(workspace, "entry.ts");
await writeFile(
  entry,
  `import worker from ${JSON.stringify(join(root, "apps/files-worker/src/index.ts"))};
import { ObjectDeletionGate as Gate } from ${JSON.stringify(join(root, "apps/files-worker/src/deletionGate.ts"))};
export default worker;
export class ObjectDeletionGate extends Gate {
  constructor(state, env) {
    const raw = env.BUCKET;
    const bucket = new Proxy(raw, {
      get(target, property) {
        if (property === "put") return async (...args) => {
          await raw.put(...args);
          return await new Promise(() => {});
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    super(state, { ...env, BUCKET: bucket });
  }
}
`,
  { flag: "wx", mode: 0o600 }
);
await writeFile(
  config,
  JSON.stringify({
    name: "teak-local-restart-proof",
    main: entry,
    compatibility_date: "2026-08-01",
    compatibility_flags: ["nodejs_compat"],
    r2_buckets: [{ binding: "BUCKET", bucket_name: "local-restart-proof" }],
    durable_objects: {
      bindings: [{ name: "OBJECT_GATES", class_name: "ObjectDeletionGate" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["ObjectDeletionGate"] }],
    vars: { FILES_SIGNING_SECRET: secret, SENTRY_ENVIRONMENT: "development" },
  }),
  { flag: "wx", mode: 0o600 }
);
process.env.FILES_BASE = `http://127.0.0.1:${port}`;
process.env.FILES_SIGNING_SECRET = secret;
process.env.R2_KEY_PREFIX = "dev/";
let logs = "";
let worker: ReturnType<typeof Bun.spawn> | undefined;
let collectors: Promise<void>[] = [];
const start = async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "x",
      "wrangler",
      "dev",
      "--config",
      config,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      workspace,
      "--no-types",
      "--show-interactive-dev-session=false",
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
  worker = child;
  let ready!: () => void;
  const readiness = new Promise<void>((done) => {
    ready = done;
  });
  let runtimeLogs = "";
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      const text = new TextDecoder().decode(chunk);
      logs += text;
      runtimeLogs += text;
      if (runtimeLogs.includes("Ready on http://")) {
        ready();
      }
    }
  };
  collectors = [
    collect(child.stdout as ReadableStream<Uint8Array>),
    collect(child.stderr as ReadableStream<Uint8Array>),
  ];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      readiness,
      child.exited.then((code) => {
        throw new Error(`Worker exited before readiness: ${code}`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Readiness deadline")),
          60_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const stop = async () => {
  if (worker) {
    worker.kill();
    await worker.exited;
    await Promise.all(collectors);
    worker = undefined;
  }
};
const invoke = async <T>(
  op: "head-object" | "freeze-object" | "delete-objects"
) => {
  const result = await callFilesWorkerJson<T>({
    op,
    params: op === "delete-objects" ? { keys: [key] } : { key },
  });
  if (result.kind !== "ok") {
    throw new Error(`Worker ${op} unavailable`);
  }
  return result.data;
};
const report = {
  key,
  workspace,
  origin: process.env.FILES_BASE,
  startedAt: new Date().toISOString(),
  checks: [] as string[],
  passed: false,
  cleanup: "isolated_local_state_retained_for_inspection",
  unproven: ["Remote R2 writes in flight during a server crash"],
};
try {
  await start();
  const controller = new AbortController();
  const pending = putObjectViaFilesWorker({
    key,
    body: new TextEncoder().encode("unknown completion proof"),
    contentType: "text/plain",
    signal: controller.signal,
  }).catch(() => null);
  const deadline = Date.now() + 15_000;
  while (!(await invoke<{ exists: boolean }>("head-object")).exists) {
    if (Date.now() > deadline) {
      throw new Error("Local PUT admission deadline");
    }
    await Bun.sleep(20);
  }
  if ((await invoke<{ frozen: boolean }>("freeze-object")).frozen) {
    throw new Error("Unknown completion was incorrectly certified");
  }
  report.checks.push(
    "committed_put_with_unknown_completion_keeps_freeze_pending"
  );
  // Locate only this Wrangler child's workerd, never another live dev process.
  const inventory = Bun.spawn(["ps", "-axo", "pid,ppid,command"], {
    stdout: "pipe",
  });
  const rows = (await new Response(inventory.stdout).text())
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .filter(Boolean);
  if (await inventory.exited) {
    throw new Error("Cannot inspect runtime process");
  }
  if (!worker) {
    throw new Error("Owned Worker missing");
  }
  const descendants = new Set([worker.pid]);
  const pendingParents = [worker.pid];
  while (pendingParents.length) {
    const parentPid = pendingParents.pop();
    for (const row of rows) {
      const pid = Number(row?.[1]);
      if (row && Number(row[2]) === parentPid && !descendants.has(pid)) {
        descendants.add(pid);
        pendingParents.push(pid);
      }
    }
  }
  const runtimes = rows.filter(
    (row) =>
      row &&
      descendants.has(Number(row[1])) &&
      /\/workerd(?:\s|$)/.test(row[3] ?? "")
  );
  if (!runtimes.length) {
    throw new Error("No owned workerd processes found");
  }
  const runtimePids = runtimes.map((row) => Number(row?.[1]));
  for (const runtimePid of runtimePids) {
    process.kill(runtimePid, "SIGKILL");
  }
  controller.abort();
  await pending;
  await stop();
  report.checks.push(`actual_workerd_sigkill_pids_${runtimePids.join("_")}`);
  await start();
  if ((await invoke<{ frozen: boolean }>("freeze-object")).frozen) {
    throw new Error("Restart lost the unknown operation marker");
  }
  report.checks.push("same_sqlite_restart_preserves_unknown_completion_denial");
  await invoke("delete-objects");
  if (
    (await invoke<{ exists: boolean }>("head-object")).exists ||
    (await invoke<{ frozen: boolean }>("freeze-object")).frozen
  ) {
    throw new Error("HEAD absence incorrectly cleared unknown completion");
  }
  report.checks.push(
    "successful_delete_and_head_absence_do_not_clear_unknown_marker"
  );
  let denied = false;
  try {
    await putObjectViaFilesWorker({
      key,
      body: new TextEncoder().encode("late"),
      contentType: "text/plain",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    denied =
      error instanceof Error &&
      error.message === "files_worker_upload_error:409";
  }
  if (!denied || (await invoke<{ exists: boolean }>("head-object")).exists) {
    throw new Error("Restart failed to fence late writes or retain absence");
  }
  report.checks.push("signed_late_put_after_restart_returns_409_object_absent");
  report.passed = true;
} finally {
  await stop();
  await writeFile(
    reportPath,
    `${JSON.stringify(
      { ...report, finishedAt: new Date().toISOString() },
      null,
      2
    )}\n`,
    { flag: "wx", mode: 0o600 }
  );
  await writeFile(
    `${reportPath}.runtime.log`,
    logs.replaceAll(secret, "[disposable test value]"),
    { flag: "wx", mode: 0o600 }
  );
}
