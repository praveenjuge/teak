import { describe, expect, test } from "bun:test";
import { buildWorkflowRpcSecretPayload } from "@teak/files-protocol";
import { hmacSha256Hex } from "../apps/files-worker/src/lib";
import { deriveWorkflowRpcSecret } from "./workflow-rpc-secret";

const workerDerivation = (root: string, origin: string) =>
  hmacSha256Hex(root, buildWorkflowRpcSecretPayload(origin));

describe("deriveWorkflowRpcSecret", () => {
  test("matches the secret the Worker derives for the deployment", async () => {
    const root = "root-secret";
    const origin = "https://prod-deployment.convex.site";
    expect(deriveWorkflowRpcSecret(root, `${origin}/`)).toBe(
      await workerDerivation(root, origin)
    );
    expect(deriveWorkflowRpcSecret(root, origin)).not.toBe(
      deriveWorkflowRpcSecret(root, "https://dev-deployment.convex.site")
    );
  });

  test("refuses a missing root secret or a URL that isn't an origin", () => {
    expect(() =>
      deriveWorkflowRpcSecret("", "https://prod-deployment.convex.site")
    ).toThrow("WORKFLOW_RPC_ROOT_SECRET");
    expect(() =>
      deriveWorkflowRpcSecret("root", "https://prod.convex.site/api")
    ).toThrow("Not a Convex");
  });
});
