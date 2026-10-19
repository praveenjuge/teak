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

test("the container images build with the repo's pinned Bun and Node", async () => {
  const bun = rootPackageJson.packageManager.replace(/^bun@/, "");
  expect(await baseImages("../container/Dockerfile")).toContain(
    `oven/bun:${bun}-alpine`
  );
  expect(await baseImages("../fetcher/Dockerfile")).toEqual([
    `oven/bun:${bun}-alpine`,
    `node:${rootPackageJson.engines.node}-alpine`,
  ]);
});

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
  expect(config.name).toBe("teak-files-dev");
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

// dev:local reads the production vars, so it must blank the token.
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

// Remote local development runs the development config, never production's.
test("dev runs the development Worker config", () => {
  expect(packageJson.scripts.dev).toBe(
    "bun --no-env-file run ../../scripts/files-worker-dev.ts"
  );
});
