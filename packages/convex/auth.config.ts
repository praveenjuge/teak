import type { AuthConfig } from "convex/server";
import {
  isLoopbackOrigin,
  parseWorkosApiBase,
  workosIssuer,
} from "./shared/workosApi";

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

// Convex rejects an auth config that reads an unset variable, so hosted
// deployments never read the API base and always trust WorkOS's own keys. A
// local backend may point at the WorkOS emulator; `bun run setup` always sets
// WORKOS_API_BASE_URL there.
const apiBase = isLoopbackOrigin(process.env.CONVEX_CLOUD_URL)
  ? parseWorkosApiBase(process.env.WORKOS_API_BASE_URL)
  : parseWorkosApiBase(undefined);

export default {
  providers: [
    {
      type: "customJwt" as const,
      issuer: workosIssuer(clientId),
      algorithm: "RS256" as const,
      jwks: new URL(`/sso/jwks/${clientId}`, apiBase).href,
    },
  ],
} satisfies AuthConfig;
