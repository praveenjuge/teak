import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { unstable_readConfig } from "wrangler";
import rootPackageJson from "../../../package.json";
import packageJson from "../package.json";
import { MAX_DELIVERIES } from "./queues/aiBackfill";

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
