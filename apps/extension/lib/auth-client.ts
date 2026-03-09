import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";
import { createAuthClient } from "better-auth/react";

const baseURL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";

export const authClient = createAuthClient({
  baseURL,
  plugins: [convexClient()],
});
