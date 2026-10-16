import { github } from "@e2e-dev/github";
import type { E2EConfig } from "e2e";

/**
 * Settings every suite config shares. Each config writes its own results
 * directory, since a run empties `results/` when it starts, and posts its own
 * pull request comment, keyed by suite.
 */
export const suiteConfig = (
  suite: string,
  overrides: Omit<E2EConfig, "reporters" | "output" | "cache"> &
    Partial<Pick<E2EConfig, "cache">>
): E2EConfig => ({
  cache: "off",
  assertionTimeout: 15_000,
  timeout: 120_000,
  trace: "retain-on-failure",
  video: "retain-on-failure",
  output: `.e2e/${suite}`,
  reporters: ["list", "junit", "markdown", github({ key: suite })],
  ...overrides,
});
