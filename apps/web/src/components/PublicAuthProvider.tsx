"use client";

import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { getConvexUrl } from "@/lib/public-env";
import { AuthModeProvider } from "./AuthModeProvider";

const convex = new ConvexReactClient(getConvexUrl());

export function PublicAuthProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <ConvexQueryCacheProvider>
        <AuthModeProvider>{children}</AuthModeProvider>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  );
}
