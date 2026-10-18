import { type ChildProcess, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorkflowRpcSecretPayload } from "@teak/files-protocol";
import { filesWorkerOrigin, type StackPorts, stackUrls } from "./config";

// The Files Worker on the E2E stack: `wrangler dev` in local mode, with
// Workflows, Queues, R2, KV, Durable Objects and Analytics Engine emulated by
// Miniflare. What needs a Cloudflare account or Docker is left out: Workers
// AI and the Vectorize index are service bindings to fakes
// (apps/files-worker/e2e/fakeAi.ts); Browser Run and the two Containers are
// absent, so link fetching, screenshots and media rendering fail the way they
// do when those services are down.

const ROOT = join(import.meta.dir, "../../../..");
const WORKER_DIR = join(ROOT, "apps/files-worker");
const STATE_DIR = join(ROOT, ".agents/.state/e2e-files-worker");

export const E2E_FILES_SIGNING_SECRET =
  "teak-e2e-files-signing-secret-local-only-0001";

export const E2E_WORKFLOW_RPC_ROOT_SECRET =
  "teak-e2e-workflow-rpc-root-secret-local-only-0001";

export const e2eWorkflowRpcSecret = (origin: string) =>
  createHmac("sha256", E2E_WORKFLOW_RPC_ROOT_SECRET)
    .update(buildWorkflowRpcSecretPayload(origin))
    .digest("hex");

export const filesWorkerDeploymentVars = (ports: StackPorts) => ({
  FILES_BASE: filesWorkerOrigin(ports),
  FILES_SIGNING_SECRET: E2E_FILES_SIGNING_SECRET,
  WORKFLOW_RPC_SECRET: e2eWorkflowRpcSecret(stackUrls(ports).apiOrigin),
});

const readCompatibilityDate = (): string => {
  const source = readFileSync(join(WORKER_DIR, "wrangler.jsonc"), "utf8");
  const match = /"compatibility_date":\s*"([^"]+)"/u.exec(source);
  if (!match?.[1]) {
    throw new Error(
      "apps/files-worker/wrangler.jsonc has no compatibility_date"
    );
  }
  return match[1];
};

const QUEUE_ROLES = [
  "object-deletions",
  "object-deletions-dlq",
  "ai-backfill",
  "workos-events",
  "workos-events-dlq",
  "r2-events",
] as const;

const queueName = (role: string) => `teak-e2e-${role}`;

export const filesWorkerConfigs = (ports: StackPorts) => {
  const compatibilityDate = readCompatibilityDate();
  const urls = stackUrls(ports);
  const worker = {
    name: "teak-files-e2e",
    main: join(WORKER_DIR, "src/index.ts"),
    compatibility_date: compatibilityDate,
    compatibility_flags: ["nodejs_compat"],
    r2_buckets: [{ binding: "BUCKET", bucket_name: "teak-files-e2e" }],
    kv_namespaces: [
      { binding: "EDGE_IDENTITY", id: "teak-e2e-edge-identity" },
      { binding: "LINK_PAGE_CACHE", id: "teak-e2e-link-page-cache" },
    ],
    durable_objects: {
      bindings: [
        { name: "OBJECT_GATES", class_name: "ObjectDeletionGate" },
        { name: "MEDIA_RENDERER", class_name: "MediaRenderer" },
        { name: "LINK_FETCHER", class_name: "LinkFetcher" },
      ],
    },
    migrations: [
      {
        tag: "e2e-v1",
        new_sqlite_classes: [
          "ObjectDeletionGate",
          "MediaRenderer",
          "LinkFetcher",
        ],
      },
    ],
    ratelimits: [
      {
        name: "API_REQUEST_LIMITER",
        namespace_id: "9941",
        simple: { limit: 120, period: 60 },
      },
      {
        name: "UNKNOWN_CREDENTIAL_LIMITER",
        namespace_id: "9942",
        simple: { limit: 60, period: 60 },
      },
    ],
    workflows: [
      ["card-processing", "CARD_PROCESSING", "CardProcessingWorkflow"],
      ["export", "EXPORTS", "ExportWorkflow"],
      ["import", "IMPORTS", "ImportWorkflow"],
      ["account-deletion", "ACCOUNT_DELETION", "AccountDeletionWorkflow"],
      ["maintenance", "MAINTENANCE", "MaintenanceWorkflow"],
    ].map(([name, binding, className]) => ({
      name: `teak-e2e-${name}`,
      binding,
      class_name: className,
    })),
    queues: {
      producers: [
        ["OBJECT_DELETIONS", "object-deletions"],
        ["AI_BACKFILL", "ai-backfill"],
        ["WORKOS_EVENTS", "workos-events"],
        ["R2_EVENTS", "r2-events"],
      ].map(([binding, role]) => ({ binding, queue: queueName(role) })),
      consumers: QUEUE_ROLES.map((role) => ({
        queue: queueName(role),
        max_batch_size: 10,
        max_batch_timeout: 1,
        max_retries: 3,
        ...(role === "object-deletions" || role === "workos-events"
          ? { dead_letter_queue: queueName(`${role}-dlq`) }
          : {}),
      })),
    },
    analytics_engine_datasets: [
      { binding: "AI_USAGE", dataset: "teak_e2e_ai_usage" },
    ],
    services: [
      { binding: "AI", service: "teak-e2e-fake-ai" },
      {
        binding: "CARD_VECTORS_0",
        entrypoint: "FakeVectorize",
        service: "teak-e2e-fake-ai",
      },
    ],
    images: { binding: "IMAGES" },
    triggers: {
      crons: [
        "0 2 * * *",
        "0 3 * * *",
        "0 */6 * * *",
        "0 4 * * 1",
        "15 * * * *",
        "45 * * * *",
      ],
    },
    vars: {
      CONVEX_SITE_URLS: urls.apiOrigin,
      FILES_PUBLIC_ORIGIN: filesWorkerOrigin(ports),
      FILES_SIGNING_SECRET: E2E_FILES_SIGNING_SECRET,
      WORKFLOW_RPC_ROOT_SECRET: E2E_WORKFLOW_RPC_ROOT_SECRET,
      API_PUBLIC_HOST: new URL(urls.appOrigin).hostname,
      API_UPSTREAM_ORIGIN: urls.apiOrigin,
      MEDIA_RENDERER_INSTANCES: "1",
      LINK_FETCHER_INSTANCES: "1",
    },
  };
  const fakeAi = {
    name: "teak-e2e-fake-ai",
    main: join(WORKER_DIR, "e2e/fakeAi.ts"),
    compatibility_date: compatibilityDate,
  };
  return { fakeAi, worker };
};

export interface RunningFilesWorker {
  child: ChildProcess;
  origin: string;
}

export const startFilesWorker = (
  ports: StackPorts,
  log: NodeJS.WritableStream
): RunningFilesWorker => {
  rmSync(STATE_DIR, { force: true, recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  const { fakeAi, worker } = filesWorkerConfigs(ports);
  const workerConfig = join(STATE_DIR, "wrangler.json");
  const fakeAiConfig = join(STATE_DIR, "fake-ai.wrangler.json");
  writeFileSync(workerConfig, `${JSON.stringify(worker, null, 2)}\n`);
  writeFileSync(fakeAiConfig, `${JSON.stringify(fakeAi, null, 2)}\n`);
  const child = spawn(
    "bunx",
    [
      "wrangler",
      "dev",
      "--config",
      workerConfig,
      "--config",
      fakeAiConfig,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(ports.filesWorker),
      "--inspector-port",
      String(ports.filesWorkerInspector),
      "--persist-to",
      join(STATE_DIR, "state"),
      "--show-interactive-dev-session=false",
      "--test-scheduled",
    ],
    {
      cwd: WORKER_DIR,
      detached: true,
      env: {
        ...process.env,
        // Local mode needs no account; never pick up a developer's login.
        CLOUDFLARE_API_TOKEN: "",
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream?.pipe(log, { end: false });
  }
  return { child, origin: filesWorkerOrigin(ports) };
};
