"use client";

import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import type React from "react";
import { useCallback, useMemo } from "react";

const convex = new ConvexReactClient(
  process.env.EXPO_PUBLIC_CONVEX_URL as string,
  {
    expectAuth: true,
    unsavedChangesWarning: false,
  }
);

function useConvexClerkAuth() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<string | null> => {
      try {
        return await getToken({
          skipCache: forceRefreshToken,
          template: "convex",
        });
      } catch {
        return null;
      }
    },
    [getToken]
  );

  return useMemo(
    () => ({
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn ?? false,
      fetchAccessToken,
    }),
    [fetchAccessToken, isLoaded, isSignedIn]
  );
}

export default function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexClerkAuth}>
        {children}
      </ConvexProviderWithAuth>
    </ClerkProvider>
  );
}
