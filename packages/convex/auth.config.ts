import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { readJwksDocument } from "./env";

const readinessClientId =
  process.env.WORKOS_ENVIRONMENT_ID === "environment_01KBYSVN9RVQ1JXACG3MDMQZGA"
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
