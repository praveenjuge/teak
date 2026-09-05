import { GlobalFileDropProvider } from "@teak/ui/hooks/GlobalFileDropProvider";
import { connection } from "next/server";
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
  await connection();
  const initialToken = await getToken();

  return (
    <ConvexClientProvider initialToken={initialToken}>
      <SentryUserManager />
      <ClientAuthBoundary>
        <GlobalFileDropProvider upgradeUrl="/settings">
          {children}
        </GlobalFileDropProvider>
      </ClientAuthBoundary>
    </ConvexClientProvider>
  );
}
