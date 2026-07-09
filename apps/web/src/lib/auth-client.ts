import { convexClient } from "@convex-dev/better-auth/client/plugins";
import type { AuthClient } from "@convex-dev/better-auth/react";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [convexClient()],
});

// @convex-dev/better-auth narrows provider clients more than Better Auth 1.6.23.
export const convexAuthClient = authClient as unknown as AuthClient;
