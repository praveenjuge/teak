import { describe, expect, test } from "bun:test";
import { DEV_DEPLOYMENT, resolveConvexAccess } from "./dev-deployment.ts";
import { devDeploymentCliEnv } from "./setup-deployment.ts";

describe("devDeploymentCliEnv", () => {
  test("a Convex login points CLI calls at the dev deployment without touching the caller's env", () => {
    const env = { CONVEX_DEPLOYMENT: "anonymous:anonymous-teak", PATH: "/bin" };
    expect(devDeploymentCliEnv(resolveConvexAccess(undefined), env)).toEqual({
      CONVEX_DEPLOYMENT: DEV_DEPLOYMENT,
      PATH: "/bin",
    });
    expect(env.CONVEX_DEPLOYMENT).toBe("anonymous:anonymous-teak");
  });

  test("a dev deploy key selects the deployment by itself", () => {
    const access = resolveConvexAccess(`${DEV_DEPLOYMENT}|secret`);
    expect(access.kind).toBe("deploy-key");
    const env = { CONVEX_DEPLOY_KEY: `${DEV_DEPLOYMENT}|secret` };
    expect(devDeploymentCliEnv(access, env)).toEqual(env);
  });
});
