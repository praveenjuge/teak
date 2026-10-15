import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { unstable_readConfig } from "wrangler";
import packageJson from "../package.json";

test("only the production worker reports errors to PostHog", () => {
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, "../wrangler.jsonc"),
  });
  expect(String(config.vars.POSTHOG_PROJECT_TOKEN)).toStartWith("phc_");
  // The renderer pool size the Worker uses matches the Container's limit.
  expect(config.containers?.[0]?.max_instances).toBe(
    Number(config.vars.MEDIA_RENDERER_INSTANCES)
  );
});

test("the development worker resolves to its own bucket, gates and telemetry", () => {
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, "../development/wrangler.jsonc"),
  });
  expect(config.main).toBe(resolve(import.meta.dir, "index.ts"));
  expect(config.name).toBe("teak-files-development");
  expect(config.routes).toEqual([]);
  expect(config.r2_buckets).toEqual([
    {
      binding: "BUCKET",
      bucket_name: "teak-files-development-20261006",
      preview_bucket_name: "teak-files-development-20261006",
    },
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
  // Development errors stay out of the production PostHog project.
  expect(config.vars.POSTHOG_PROJECT_TOKEN).toBeUndefined();
  // It never proxies the public API to the production Convex deployment.
  expect(config.vars.API_PUBLIC_HOST).toBeUndefined();
  expect(config.vars.API_UPSTREAM_ORIGIN).toBeUndefined();
  expect(config.vars.API_WORKOS_ISSUER).toBeUndefined();
  expect(config.kv_namespaces).toEqual([]);
});

// wrangler dev reads the production vars, so local runs must blank the token.
test.each(["dev", "dev:local"] as const)(
  "%s sends nothing to PostHog",
  (script) => {
    const { values } = parseArgs({
      args: packageJson.scripts[script].split(" ").slice(2),
      options: {
        remote: { type: "boolean" },
        var: { type: "string", multiple: true },
      },
    });
    expect(values.var).toContain("POSTHOG_PROJECT_TOKEN:");
  }
);
