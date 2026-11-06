import { describe, expect, mock, test } from "bun:test";
import { ENV_CONTRACT } from "./env-contract.ts";

// Component configs only load inside the Convex runtime; stand-ins let Bun
// evaluate the app definition and read the env it declares.
for (const path of [
  "@convex-dev/polar/convex.config",
  "@convex-dev/rate-limiter/convex.config",
  "@vllnt/convex-api-keys/convex.config",
]) {
  mock.module(path, () => ({
    default: { componentDefinitionPath: path, defaultName: path },
  }));
}

const { default: app } = (await import(
  "../../packages/convex/convex.config.ts"
)) as { default: { _env?: Record<string, unknown> } };

// It selects a deployment for the Convex CLI; functions never read it.
const CLI_ONLY = new Set(["CONVEX_DEPLOY_KEY"]);

describe("Convex app env", () => {
  test("declares exactly the Convex variables in the env contract", () => {
    // `implicit` variables reach Convex another way (auth.config, components).
    const contract = ENV_CONTRACT.filter(
      (entry) =>
        entry.targets.includes("convex") &&
        !entry.implicit &&
        !CLI_ONLY.has(entry.name)
    ).map((entry) => entry.name);
    expect(Object.keys(app._env ?? {}).sort()).toEqual(contract.sort());
  });
});
