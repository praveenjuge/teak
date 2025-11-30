import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

const baseURL = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://app.teakvault.com";

export const authClient = createAuthClient({
  baseURL,
  plugins: [convexClient()],
});
