import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { readJwksDocument } from "./env";

export default {
  providers: [getAuthConfigProvider({ jwks: readJwksDocument() })],
} satisfies AuthConfig;
