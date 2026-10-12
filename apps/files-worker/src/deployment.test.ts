import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { unstable_readConfig } from "wrangler";

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
  ]);
  expect(config.containers).toEqual([
    expect.objectContaining({
      class_name: "MediaRenderer",
      instance_type: "basic",
      max_instances: 2,
    }),
  ]);
  expect(config.vars.MEDIA_RENDERER_INSTANCES).toBe("2");
  expect(config.ai?.binding).toBe("AI");
  expect(config.images?.binding).toBe("IMAGES");
  // Development errors stay out of the production PostHog project.
  expect(config.vars.POSTHOG_PROJECT_TOKEN).toBeUndefined();
});
