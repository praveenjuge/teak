import { describe, expect, test } from "bun:test";
import { buildWorkflowRpcSecretPayload } from "@teak/files-protocol";
import { deriveWorkflowRpcSecret } from "./workflow-rpc-secret";

/** The Worker's derivation (`workflowRpcSecret`), with Web Crypto as it uses. */
const workerDerivation = async (root: string, origin: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(root),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(buildWorkflowRpcSecretPayload(origin))
  );
  return Buffer.from(signature).toString("hex");
};

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
