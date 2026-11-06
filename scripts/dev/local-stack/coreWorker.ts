import { type ChildProcess, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorkflowRpcSecretPayload } from "@teak/files-protocol";
import {
  coreWorkerOrigin,
  E2E_EMAIL_INBOUND_SIGNING_SECRET,
  type StackPorts,
  stackUrls,
} from "./config.ts";

// The Core Worker on the E2E stack: `wrangler dev` in local mode, with
// Workflows, Queues, R2, KV, Durable Objects and Analytics Engine emulated by
// Miniflare. What needs a Cloudflare account or Docker is left out: Workers
// AI and the Vectorize index are service bindings to fakes
// (apps/core-worker/e2e/fakeAi.ts); Browser Run and the two Containers are
// absent, so link fetching, screenshots and media rendering fail the way they
// do when those services are down. The link fetcher is a fake that answers
// like the missing Container, except for a hop to a `/teak-e2e-forward/<port>`
// path, which it makes to a server on that local port
// (apps/core-worker/e2e/fakeLinkFetcher.ts), so a link check can reach it.

const ROOT = join(import.meta.dir, "../../..");
const WORKER_DIR = join(ROOT, "apps/core-worker");
const STATE_DIR = join(ROOT, ".agents/.state/e2e-core-worker");

export const E2E_FILES_SIGNING_SECRET =
  "teak-e2e-files-signing-secret-local-only-0001";

export const E2E_WORKFLOW_RPC_ROOT_SECRET =
  "teak-e2e-workflow-rpc-root-secret-local-only-0001";

export const e2eWorkflowRpcSecret = (origin: string) =>
  createHmac("sha256", E2E_WORKFLOW_RPC_ROOT_SECRET)
    .update(buildWorkflowRpcSecretPayload(origin))
    .digest("hex");

export const coreWorkerDeploymentVars = (ports: StackPorts) => ({
  FILES_BASE: coreWorkerOrigin(ports),
  FILES_SIGNING_SECRET: E2E_FILES_SIGNING_SECRET,
  WORKFLOW_RPC_SECRET: e2eWorkflowRpcSecret(stackUrls(ports).apiOrigin),
});

interface DeployedWorker {
  compatibility_date: string;
  compatibility_flags: string[];
  durable_objects: { bindings: { class_name: string; name: string }[] };
  queues: {
    consumers: { dead_letter_queue?: string; queue: string }[];
    producers: { binding: string; queue: string }[];
  };
  ratelimits: unknown[];
  triggers: { crons: string[] };
  workflows: { binding: string; class_name: string; name: string }[];
}

/**
 * The deployed Worker's config (apps/core-worker/wrangler.jsonc). The local
 * Worker takes its runtime, Workflows, queues, rate limits and Cron Triggers
 * from it, so a new Workflow or schedule runs locally without another edit.
 */
const readDeployedWorker = (): DeployedWorker =>
  Bun.JSONC.parse(
    readFileSync(join(WORKER_DIR, "wrangler.jsonc"), "utf8")
  ) as DeployedWorker;

/** `teak-export` → `teak-e2e-export`, so local names never meet deployed ones. */
const localName = (name: string) => name.replace(/^teak-/, "teak-e2e-");

const FAKE_AI_WORKER = "teak-e2e-fake-ai";

export const coreWorkerConfigs = (ports: StackPorts) => {
  const deployed = readDeployedWorker();
  const compatibilityDate = deployed.compatibility_date;
  const urls = stackUrls(ports);
  const worker = {
    name: "teak-files-e2e",
    main: join(WORKER_DIR, "src/index.ts"),
    compatibility_date: compatibilityDate,
    compatibility_flags: deployed.compatibility_flags,
    assets: {
      directory: join(WORKER_DIR, "assets"),
      binding: "ASSETS",
      run_worker_first: true,
    },
    r2_buckets: [{ binding: "BUCKET", bucket_name: "teak-files-e2e" }],
    kv_namespaces: [
      { binding: "EDGE_IDENTITY", id: "teak-e2e-edge-identity" },
      { binding: "LINK_PAGE_CACHE", id: "teak-e2e-link-page-cache" },
    ],
    durable_objects: {
      // The link fetcher is a Container; the fake worker stands in for it.
      bindings: deployed.durable_objects.bindings.map((binding) =>
        binding.name === "LINK_FETCHER"
          ? {
              name: binding.name,
              class_name: "FakeLinkFetcher",
              script_name: FAKE_AI_WORKER,
            }
          : binding
      ),
    },
    migrations: [
      {
        tag: "e2e-v1",
        new_sqlite_classes: deployed.durable_objects.bindings.map(
          (binding) => binding.class_name
        ),
      },
    ],
    ratelimits: deployed.ratelimits,
    workflows: deployed.workflows.map((workflow) => ({
      ...workflow,
      name: localName(workflow.name),
    })),
    queues: {
      producers: deployed.queues.producers.map((producer) => ({
        ...producer,
        queue: localName(producer.queue),
      })),
      // Small, quick batches and few retries, so a test sees a message's
      // outcome in seconds rather than the deployed minutes.
      consumers: deployed.queues.consumers.map((consumer) => ({
        queue: localName(consumer.queue),
        max_batch_size: 10,
        max_batch_timeout: 1,
        max_retries: 3,
        ...(consumer.dead_letter_queue
          ? { dead_letter_queue: localName(consumer.dead_letter_queue) }
          : {}),
      })),
    },
    analytics_engine_datasets: [
      { binding: "AI_USAGE", dataset: "teak_e2e_ai_usage" },
    ],
    services: [
      { binding: "AI", service: FAKE_AI_WORKER },
      {
        binding: "CARD_VECTORS_0",
        entrypoint: "FakeVectorize",
        service: FAKE_AI_WORKER,
      },
    ],
    images: { binding: "IMAGES" },
    triggers: { crons: deployed.triggers.crons },
    vars: {
      CONVEX_SITE_URLS: urls.apiOrigin,
      FILES_PUBLIC_ORIGIN: coreWorkerOrigin(ports),
      FILES_SIGNING_SECRET: E2E_FILES_SIGNING_SECRET,
      WORKFLOW_RPC_ROOT_SECRET: E2E_WORKFLOW_RPC_ROOT_SECRET,
      EMAIL_INBOUND_SIGNING_SECRET: E2E_EMAIL_INBOUND_SIGNING_SECRET,
      INBOUND_EMAIL_DOMAIN: "in.teakvault.com",
      API_PUBLIC_HOST: new URL(urls.appOrigin).hostname,
      API_UPSTREAM_ORIGIN: urls.apiOrigin,
      MEDIA_RENDERER_INSTANCES: "1",
      LINK_FETCHER_INSTANCES: "1",
    },
  };
  const fakeAi = {
    name: FAKE_AI_WORKER,
    main: join(WORKER_DIR, "e2e/fakeAi.ts"),
    compatibility_date: compatibilityDate,
    durable_objects: {
      bindings: [{ name: "LINK_FETCHER", class_name: "FakeLinkFetcher" }],
    },
    migrations: [{ tag: "e2e-v1", new_sqlite_classes: ["FakeLinkFetcher"] }],
  };
  return { fakeAi, worker };
};

export interface RunningCoreWorker {
  child: ChildProcess;
  origin: string;
}

export const startCoreWorker = (
  ports: StackPorts,
  log: NodeJS.WritableStream,
  env: NodeJS.ProcessEnv = process.env
): RunningCoreWorker => {
  rmSync(STATE_DIR, { force: true, recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  const { fakeAi, worker } = coreWorkerConfigs(ports);
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
      String(ports.coreWorker),
      "--inspector-port",
      String(ports.coreWorkerInspector),
      "--persist-to",
      join(STATE_DIR, "state"),
      "--show-interactive-dev-session=false",
      "--test-scheduled",
    ],
    {
      cwd: WORKER_DIR,
      detached: true,
      env: {
        ...env,
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
  return { child, origin: coreWorkerOrigin(ports) };
};
