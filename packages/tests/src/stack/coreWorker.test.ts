import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import deployed from "../../../../apps/core-worker/wrangler.jsonc";
import { slotPorts } from "../../../../scripts/worktree-env.ts";
import { coreWorkerOrigin } from "./config";
import { coreWorkerConfigs } from "./coreWorker";

describe("coreWorkerConfigs", () => {
  test("serves files from a host the API proxy leaves alone", () => {
    const ports = slotPorts(3);
    const { vars } = coreWorkerConfigs(ports).worker;
    expect(vars.API_PUBLIC_HOST).toBe("localhost");
    expect(new URL(coreWorkerOrigin(ports)).hostname).not.toBe(
      vars.API_PUBLIC_HOST
    );
  });

  test("reads the getting-started files through the Worker, as deployed", () => {
    const { assets } = coreWorkerConfigs(slotPorts(3)).worker;
    expect(assets).toMatchObject({ binding: "ASSETS", run_worker_first: true });
    expect(
      existsSync(join(assets.directory, "onboarding/coral-lily.webp"))
    ).toBe(true);
  });

  test("binds the link fetcher to the fake worker's stand-in", () => {
    const { fakeAi, worker } = coreWorkerConfigs(slotPorts(3));
    expect(worker.durable_objects.bindings).toContainEqual({
      name: "LINK_FETCHER",
      class_name: "FakeLinkFetcher",
      script_name: fakeAi.name,
    });
    expect(fakeAi.migrations).toEqual([
      { tag: "e2e-v1", new_sqlite_classes: ["FakeLinkFetcher"] },
    ]);
  });
});

interface Named {
  binding?: string;
  name?: string;
}

/** Every binding name a Wrangler config gives the Worker's `env`. */
const bindingNames = (config: Record<string, unknown>): string[] => {
  const list = (value: unknown): Named[] =>
    Array.isArray(value) ? (value as Named[]) : [];
  const one = (value: unknown): Named[] =>
    value && typeof value === "object" ? [value as Named] : [];
  const queues = (config.queues ?? {}) as { producers?: unknown };
  const durableObjects = (config.durable_objects ?? {}) as {
    bindings?: unknown;
  };
  return [
    ...one(config.assets),
    ...one(config.ai),
    ...one(config.images),
    ...one(config.browser),
    ...list(config.r2_buckets),
    ...list(config.kv_namespaces),
    ...list(config.ratelimits),
    ...list(durableObjects.bindings),
    ...list(config.workflows),
    ...list(queues.producers),
    ...list(config.analytics_engine_datasets),
    ...list(config.vectorize),
    ...list(config.services),
  ]
    .map((entry) => entry.binding ?? entry.name ?? "")
    .filter(Boolean)
    .sort();
};

// Bindings the E2E Worker leaves out, and why. Anything else the deployed
// Worker binds must be bound here too, real or faked, so a new binding can't
// leave the local stack (and `bun run dev --local`) silently without it.
const LEFT_OUT: Record<string, string> = {
  BROWSER:
    "Browser Run needs a Cloudflare account; without it screenshots fail as they do when the service is down",
};

describe("coreWorkerConfigs matches the deployed Worker", () => {
  const { worker } = coreWorkerConfigs(slotPorts(3));

  test("binds everything the deployed Worker binds", () => {
    const local = new Set(bindingNames(worker));
    const missing = bindingNames(deployed).filter(
      (name) => !(local.has(name) || name in LEFT_OUT)
    );
    expect(missing).toEqual([]);
    for (const name of Object.keys(LEFT_OUT)) {
      expect(bindingNames(deployed)).toContain(name);
      expect(local.has(name)).toBe(false);
    }
  });

  test("runs the same Workflow classes and cron schedules", () => {
    const classes = (config: { workflows?: { class_name: string }[] }) =>
      (config.workflows ?? []).map((flow) => flow.class_name).sort();
    expect(classes(worker)).toEqual(classes(deployed));
    expect(worker.triggers.crons).toEqual(deployed.triggers.crons);
  });
});
