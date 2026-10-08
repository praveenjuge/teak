import type { AuthConfig } from "convex/server";

// Convex trusts AuthKit session tokens for this deployment's WorkOS client.
// WorkOS is the only sign-in provider, so a deployment without one fails here.
const clientId = process.env.WORKOS_CLIENT_ID;
if (!clientId) {
  throw new Error(
    "WORKOS_CLIENT_ID is required: WorkOS is the only sign-in provider."
  );
}
if (!/^client_[A-Za-z0-9]+$/.test(clientId)) {
  throw new Error("WORKOS_CLIENT_ID must be a WorkOS client ID.");
}

export default {
  providers: [
    {
      type: "customJwt" as const,
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256" as const,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ],
} satisfies AuthConfig;
