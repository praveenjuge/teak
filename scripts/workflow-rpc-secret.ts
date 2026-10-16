#!/usr/bin/env bun

// Prints the WORKFLOW_RPC_SECRET a Convex deployment needs, derived from the
// Files Worker's WORKFLOW_RPC_ROOT_SECRET and the deployment's HTTP actions
// origin. Read the root secret from the environment so it never lands in
// shell history:
//
//   WORKFLOW_RPC_ROOT_SECRET=… bun scripts/workflow-rpc-secret.ts https://<deployment>.convex.site
//
// then set the output with `bunx convex env set WORKFLOW_RPC_SECRET` on that
// deployment.

import { createHmac } from "node:crypto";
import {
  buildWorkflowRpcSecretPayload,
  normalizeConvexSiteUrl,
} from "@teak/files-protocol";

export const deriveWorkflowRpcSecret = (
  rootSecret: string,
  convexSiteUrl: string
): string => {
  const origin = normalizeConvexSiteUrl(convexSiteUrl);
  if (!origin) {
    throw new Error(`Not a Convex HTTP actions origin: ${convexSiteUrl}`);
  }
  if (!rootSecret) {
    throw new Error("WORKFLOW_RPC_ROOT_SECRET is not set");
  }
  return createHmac("sha256", rootSecret)
    .update(buildWorkflowRpcSecretPayload(origin))
    .digest("hex");
};

if (import.meta.main) {
  const [origin, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!origin || rest.length > 0) {
    console.error(
      "Usage: WORKFLOW_RPC_ROOT_SECRET=… bun scripts/workflow-rpc-secret.ts https://<deployment>.convex.site"
    );
    process.exit(1);
  }
  console.log(
    deriveWorkflowRpcSecret(process.env.WORKFLOW_RPC_ROOT_SECRET ?? "", origin)
  );
}
