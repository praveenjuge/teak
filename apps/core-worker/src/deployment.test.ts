import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { WORKFLOW_BINDINGS } from "@teak/files-protocol";
import { unstable_readConfig } from "wrangler";
import rootPackageJson from "../../../package.json";
import packageJson from "../package.json";
import { aiRunOptions } from "./ai/aiGateway";
import { DEFAULT_AI_USAGE_DATASET } from "./ai/aiUsageRollup";
import { MAX_DELIVERIES } from "./queues/aiBackfill";
import * as entrypoints from "./workflows/entrypoints";

const CONFIGS = [
  ["production", "../wrangler.jsonc"],
  ["development", "../development/wrangler.jsonc"],
  ["self-host", "../self-host/wrangler.jsonc"],
] as const;

const baseImages = async (dockerfile: string): Promise<string[]> =>
  Array.from(
    (await Bun.file(resolve(import.meta.dir, dockerfile)).text()).matchAll(
      /^FROM\s+(?:--\S+\s+)*(\S+)/gm
    ),
    (match) => match[1] ?? ""
  );

test("the container images build with the repo's pinned Bun on one Alpine", async () => {
  const bun = rootPackageJson.packageManager.replace(/^bun@/, "");
  const renderer = await baseImages("../container/Dockerfile");
  const fetcher = await baseImages("../fetcher/Dockerfile");
  expect(renderer[0]).toBe(`oven/bun:${bun}-alpine`);
  expect(fetcher[0]).toBe(`oven/bun:${bun}-alpine`);
  expect(fetcher[1]).toStartWith("alpine:");
  expect(fetcher).toEqual(renderer);
});

// Both Workers were renamed in place (production from teak-files-proxy, then
// teak-files-prod; development from teak-files-dev). Their container apps keep
// their old names, and a deploy that asks for new ones fails.
test.each([
  [
    "production",
    "../wrangler.jsonc",
    "core-worker",
    ["teak-files-proxy-mediarenderer", "teak-files-proxy-linkfetcher"],
  ],
  [
    "development",
    "../development/wrangler.jsonc",
    "core-worker-dev",
    ["teak-files-dev-mediarenderer", "teak-files-dev-linkfetcher"],
  ],
])(
  "the %s worker keeps its existing container apps",
  (_name, path, workerName, containerNames) => {
    const config = unstable_readConfig({
      config: resolve(import.meta.dir, path),
    });
    expect(config.name).toBe(workerName);
    expect(config.containers?.map((container) => container.name)).toEqual(
      containerNames
    );
  }
);

test("only the production worker reports errors to PostHog", () => {
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, "../wrangler.jsonc"),
  });
  expect(String(config.vars.POSTHOG_PROJECT_TOKEN)).toStartWith("phc_");
  expect(config.containers?.[0]?.max_instances).toBe(
    Number(config.vars.MEDIA_RENDERER_INSTANCES)
  );
  expect(config.containers?.[1]?.max_instances).toBe(
    Number(config.vars.LINK_FETCHER_INSTANCES)
  );
});

// Each Workers Builds deploy resets these to what the config says, so a
// dropped key turns Issues off or puts signed links back in the logs.
test.each([
  ["production", "../wrangler.jsonc"],
  ["development", "../development/wrangler.jsonc"],
])(
  "the %s worker keeps Issues on and signed links out of its logs",
  (_name, path) => {
    const config = unstable_readConfig({
      config: resolve(import.meta.dir, path),
    });
    expect(config.observability?.issues?.enabled).toBe(true);
    expect(config.observability?.redact_query_string).toBe(true);
  }
);

test.each([
  ["production", "../wrangler.jsonc", "teak-ai-backfill"],
  ["development", "../development/wrangler.jsonc", "teak-ai-backfill-dev"],
])(
  "the %s AI backfill queue delivers a message MAX_DELIVERIES times",
  (_name, path, queue) => {
    const config = unstable_readConfig({
      config: resolve(import.meta.dir, path),
    });
    const consumer = config.queues.consumers?.find(
      (entry) => entry.queue === queue
    );
    expect((consumer?.max_retries ?? 0) + 1).toBe(MAX_DELIVERIES);
  }
);

test("the development worker resolves to its own bucket, gates and telemetry", () => {
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, "../development/wrangler.jsonc"),
  });
  expect(config.main).toBe(resolve(import.meta.dir, "index.ts"));
  expect(config.name).toBe("core-worker-dev");
  expect(config.routes).toEqual([]);
  expect(config.r2_buckets).toEqual([
    {
      binding: "BUCKET",
      bucket_name: "teak-files-development-20261006",
      preview_bucket_name: "teak-files-development-20261006",
    },
  ]);
  expect(config.vectorize).toEqual([
    { binding: "CARD_VECTORS_0", index_name: "teak-dev-cards-0" },
  ]);
  expect(config.durable_objects.bindings).toEqual([
    { name: "OBJECT_GATES", class_name: "ObjectDeletionGate" },
    { name: "MEDIA_RENDERER", class_name: "MediaRenderer" },
    { name: "LINK_FETCHER", class_name: "LinkFetcher" },
  ]);
  expect(config.containers).toEqual([
    expect.objectContaining({
      class_name: "MediaRenderer",
      instance_type: "basic",
      max_instances: 2,
    }),
    expect.objectContaining({
      class_name: "LinkFetcher",
      instance_type: "basic",
      max_instances: 2,
    }),
  ]);
  expect(config.vars.MEDIA_RENDERER_INSTANCES).toBe("2");
  expect(config.vars.LINK_FETCHER_INSTANCES).toBe("2");
  expect(config.ai?.binding).toBe("AI");
  expect(config.images?.binding).toBe("IMAGES");
  expect(config.vars.POSTHOG_PROJECT_TOKEN).toBeUndefined();
  expect(config.vars.API_PUBLIC_HOST).toBeUndefined();
  expect(config.vars.API_UPSTREAM_ORIGIN).toBeUndefined();
  expect(config.vars.API_WORKOS_ISSUER).toBeUndefined();
  expect(config.kv_namespaces).toEqual([]);
  expect(config.ratelimits ?? []).toEqual([]);
});

test("dev:local sends nothing to PostHog", () => {
  const { values } = parseArgs({
    args: packageJson.scripts["dev:local"].split(" ").slice(2),
    options: {
      remote: { type: "boolean" },
      var: { type: "string", multiple: true },
    },
  });
  expect(values.var).toContain("POSTHOG_PROJECT_TOKEN:");
});

test("dev runs the development Worker config", () => {
  expect(packageJson.scripts.dev).toBe(
    "bun --no-env-file run ../../scripts/dev/core-worker-dev.ts"
  );
});

const readWorkerConfig = (path: string) =>
  unstable_readConfig({ config: resolve(import.meta.dir, path) });

// What a self-hosted deployment may change: its name, where it answers,
// resource IDs Wrangler provisions, container app names and per-deployment
// vars. Everything else must match production, so a binding, queue, cron or
// limit added to one config is added to both.
const deploymentNeutral = (path: string) => {
  const {
    name: _name,
    account_id: _accountId,
    routes: _routes,
    workers_dev: _workersDev,
    vars: _vars,
    r2_buckets,
    kv_namespaces,
    containers,
    assets,
    configPath,
    userConfigPath: _userConfigPath,
    topLevelName: _topLevelName,
    ...rest
  } = readWorkerConfig(path) as ReturnType<typeof readWorkerConfig> &
    Record<string, unknown>;
  return {
    ...rest,
    assets: assets && {
      ...assets,
      directory:
        assets.directory && resolve(String(configPath), "..", assets.directory),
    },
    r2Bindings: r2_buckets.map((bucket) => bucket.binding),
    kvBindings: kv_namespaces.map((namespace) => namespace.binding),
    containers: containers?.map(
      ({ name: _containerName, ...container }) => container
    ),
  };
};

test("the self-host config matches production apart from deployment values", () => {
  expect(deploymentNeutral("../self-host/wrangler.jsonc")).toEqual(
    deploymentNeutral("../wrangler.jsonc")
  );
});

test("the self-host config names nothing of Teak's own deployment", async () => {
  const source = await Bun.file(
    resolve(import.meta.dir, "../self-host/wrangler.jsonc")
  ).text();
  expect(source).not.toMatch(/teakvault|convex\.site|authkit\.app|phc_/);
  const config = readWorkerConfig("../self-host/wrangler.jsonc");
  expect(config.account_id).toBeUndefined();
  expect(config.routes).toEqual([]);
  expect(config.workers_dev).toBe(true);
  expect(config.kv_namespaces.map((namespace) => namespace.id)).toEqual([
    undefined,
    undefined,
  ]);
  expect(Object.keys(config.vars).sort()).toEqual([
    "AI_GATEWAY_ID",
    "LINK_FETCHER_INSTANCES",
    "MAX_BODY_BYTES",
    "MEDIA_RENDERER_INSTANCES",
  ]);
  expect(
    config.containers?.map((container) => container.max_instances)
  ).toEqual([
    Number(config.vars.MEDIA_RENDERER_INSTANCES),
    Number(config.vars.LINK_FETCHER_INSTANCES),
  ]);
});

test("deploy:self-host runs the self-host deploy script", () => {
  expect(packageJson.scripts["deploy:self-host"]).toBe(
    "bun --no-env-file run ../../scripts/cloudflare/self-host-deploy.ts"
  );
});

test("the self-host config sends Workers AI calls through the default gateway", () => {
  const config = readWorkerConfig("../self-host/wrangler.jsonc");
  expect(
    aiRunOptions({ AI_GATEWAY_ID: String(config.vars.AI_GATEWAY_ID) })
  ).toEqual({ gateway: { collectLog: false, id: "default", skipCache: true } });
});

// Each workflow runs under the binding WORKFLOW_BINDINGS names, in every
// config the Worker is deployed from.
test.each(CONFIGS)(
  "the %s config binds each workflow by its protocol name",
  (_name, path) => {
    const config = unstable_readConfig({
      config: resolve(import.meta.dir, path),
    });
    expect(config.workflows.map((workflow) => workflow.binding).sort()).toEqual(
      Object.values(WORKFLOW_BINDINGS).sort()
    );
    for (const workflow of config.workflows) {
      expect(entrypoints).toHaveProperty(workflow.class_name);
    }
  }
);

test.each(CONFIGS)(
  "the %s config reads AI usage from the dataset its AI_USAGE binding writes",
  (_name, path) => {
    const config = unstable_readConfig({
      config: resolve(import.meta.dir, path),
    });
    const written = config.analytics_engine_datasets.find(
      (dataset) => dataset.binding === "AI_USAGE"
    )?.dataset;
    expect(
      String(config.vars.AI_USAGE_DATASET ?? DEFAULT_AI_USAGE_DATASET)
    ).toBe(String(written));
  }
);

test.each([
  ["production", "../wrangler.jsonc", "https://files.teakvault.com"],
  [
    "development",
    "../development/wrangler.jsonc",
    "https://core-worker-dev.praveenjuge.workers.dev",
  ],
])("the %s worker names its own public origin", (_name, path, origin) => {
  // The Worker signs its image URLs to this origin, and has no default.
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, path),
  });
  expect(config.vars.FILES_PUBLIC_ORIGIN).toBe(origin);
});
