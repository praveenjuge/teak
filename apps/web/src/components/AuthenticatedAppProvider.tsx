import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { GlobalFileDropProvider } from "@teak/ui/hooks/GlobalFileDropProvider";
import type { ReactNode } from "react";
import { getToken } from "@/lib/auth-server";
import { ClientAuthBoundary } from "./ClientAuthBoundary";
import ConvexClientProvider from "./ConvexClientProvider";
import { SentryUserManager } from "./SentryUserManager";

export default async function AuthenticatedAppProvider({
  children,
}: {
  children: ReactNode;
}) {
  const initialToken = await getToken();

  return (
    <ConvexClientProvider initialToken={initialToken}>
      <ConvexQueryCacheProvider>
        <SentryUserManager />
        <ClientAuthBoundary>
          <GlobalFileDropProvider upgradeUrl="/settings">
            {children}
          </GlobalFileDropProvider>
        </ClientAuthBoundary>
      </ConvexQueryCacheProvider>
    </ConvexClientProvider>
  );
}
