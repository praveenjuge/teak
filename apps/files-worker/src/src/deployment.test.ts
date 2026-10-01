import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { unstable_readConfig } from "wrangler";
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
