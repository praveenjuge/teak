import type { AuthConfig } from "convex/server";

// Convex trusts AuthKit session tokens for this deployment's WorkOS client.
// Without one, nothing authenticates.
const clientId = process.env.WORKOS_CLIENT_ID;
if (clientId !== undefined && !/^client_[A-Za-z0-9]+$/.test(clientId)) {
  throw new Error("WORKOS_CLIENT_ID must be a WorkOS client ID.");
}

export default {
  providers: clientId
    ? [
        {
          type: "customJwt" as const,
          issuer: `https://api.workos.com/user_management/${clientId}`,
          algorithm: "RS256" as const,
          jwks: `https://api.workos.com/sso/jwks/${clientId}`,
        },
      ]
    : [],
} satisfies AuthConfig;
