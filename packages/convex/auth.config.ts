import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { env } from "./_generated/server";

export default {
  providers: [getAuthConfigProvider({ jwks: env.JWKS })],
} satisfies AuthConfig;
