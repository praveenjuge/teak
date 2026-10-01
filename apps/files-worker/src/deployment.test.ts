import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { unstable_DevEnv, unstable_readConfig } from "wrangler";
import packageJson from "../package.json";
import { resolveSentryOptions } from "./sentry";

test("the deployed files worker reports production failures as production", () => {
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, "../wrangler.jsonc"),
  });
  const options = resolveSentryOptions({
    SENTRY_DSN: "https://k@example.invalid/1",
    SENTRY_ENVIRONMENT: config.vars.SENTRY_ENVIRONMENT as string | undefined,
  });
  expect(options?.environment).toBe("production");
});

// Resolve only configuration, without starting runtimes or connecting bindings.
// Wrangler's CLI converts --var values to plain_text bindings before this step.
test.each(["dev", "dev:local"] as const)(
  "%s overrides production telemetry with development",
  async (script) => {
    const { values } = parseArgs({
      args: packageJson.scripts[script].split(" ").slice(2),
      options: {
        remote: { type: "boolean" },
        var: { type: "string", multiple: true },
      },
    });
    const bindings = Object.fromEntries(
      (values.var ?? []).map((entry) => {
        const separator = entry.indexOf(":");
        return [
          entry.slice(0, separator),
          {
            type: "plain_text" as const,
            value: entry.slice(separator + 1),
          },
        ];
      })
    );
    const dev = new unstable_DevEnv();
    // Stop at config resolution. Dispatching would start bundlers and runtimes.
    dev.dispatch = () => {};
    try {
      const config = await dev.config.set(
        {
          config: resolve(import.meta.dir, "../wrangler.jsonc"),
          bindings,
          dev: { watch: false, remote: false, logLevel: "none" },
        },
        true
      );
      const environment = config?.bindings.SENTRY_ENVIRONMENT;
      expect(environment?.type).toBe("plain_text");
      expect(
        resolveSentryOptions({
          SENTRY_DSN: "https://k@example.invalid/1",
          SENTRY_ENVIRONMENT:
            environment?.type === "plain_text" ? environment.value : undefined,
        })?.environment
      ).toBe("development");
    } finally {
      await dev.teardown();
    }
  }
);
