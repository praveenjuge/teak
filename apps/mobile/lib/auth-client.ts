import { expoClient } from "@better-auth/expo/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import type { AuthClient } from "@convex-dev/better-auth/react";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { getConvexSiteUrl } from "@/lib/public-env";

export const authClient = createAuthClient({
  baseURL: getConvexSiteUrl(),
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
    convexClient(),
  ] as const,
});

// @convex-dev/better-auth narrows provider clients more than Better Auth 1.6.23.
export const convexAuthClient = authClient as unknown as AuthClient;
