import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { readJwksDocument } from "./env";

const readinessClientId =
  // This built-in variable is always present. Auth config throws on an unset
  // variable, so read optional WorkOS configuration only in the proven dev deployment.
  process.env.CONVEX_CLOUD_URL ===
  "https://reminiscent-kangaroo-59.convex.cloud"
    ? process.env.WORKOS_CLIENT_ID
    : undefined;

export default {
  providers: [
    getAuthConfigProvider({ jwks: readJwksDocument() }),
    ...(readinessClientId
      ? [
          {
            type: "customJwt" as const,
            issuer: `https://api.workos.com/user_management/${readinessClientId}`,
            algorithm: "RS256" as const,
            jwks: `https://api.workos.com/sso/jwks/${readinessClientId}`,
          },
        ]
      : []),
  ],
} satisfies AuthConfig;
