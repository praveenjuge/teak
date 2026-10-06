import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { readJwksDocument } from "./env";

// Only these provisioned deployments may add WorkOS session JWT trust.
// Unknown/local deployments never read optional WorkOS configuration.
const deployment = process.env.CONVEX_CLOUD_URL;
let clientId: string | undefined;
if (deployment === "https://reminiscent-kangaroo-59.convex.cloud") {
  clientId = "client_01KBYSVNVDV2G39REZFGF0K7GD";
} else if (deployment === "https://uncommon-ladybug-882.convex.cloud") {
  clientId = "client_01M46HC8K0DD50SC59QX9DV3MX";
}
if (clientId && process.env.WORKOS_CLIENT_ID !== clientId) {
  throw new Error(
    "WorkOS AuthKit client does not match the provisioned deployment"
  );
}

export default {
  providers: [
    getAuthConfigProvider({ jwks: readJwksDocument() }),
    ...(clientId
      ? [
          {
            type: "customJwt" as const,
            issuer: `https://api.workos.com/user_management/${clientId}`,
            algorithm: "RS256" as const,
            jwks: `https://api.workos.com/sso/jwks/${clientId}`,
          },
        ]
      : []),
  ],
} satisfies AuthConfig;
