"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { convexAuthClient } from "@/lib/auth-client";
import { getConvexUrl } from "@/lib/public-env";

const convexUrl = getConvexUrl();

const convex = new ConvexReactClient(convexUrl, {
  expectAuth: true,
});

export default function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ConvexBetterAuthProvider
      authClient={convexAuthClient}
      client={convex}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
