import { GlobalFileDropProvider } from "@teak/ui/hooks/GlobalFileDropProvider";
import {
  type NoUserInfo,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AuthUnavailable } from "./AuthUnavailable";
import ConvexClientProvider from "./ConvexClientProvider";
import { SentryUserManager } from "./SentryUserManager";
import { WebMcpTools } from "./WebMcpTools";
import { WorkosAuthBoundary } from "./WorkosAuthBoundary";

export default async function AuthenticatedAppProvider({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  let initialAuth: Omit<UserInfo | NoUserInfo, "accessToken">;
  try {
    const { accessToken: _accessToken, ...session } = await withAuth();
    initialAuth = session;
  } catch {
    return <AuthUnavailable />;
  }

  return (
    <ConvexClientProvider initialAuth={initialAuth}>
      <WorkosAuthBoundary>
        <SentryUserManager />
        <WebMcpTools />
        <GlobalFileDropProvider upgradeUrl="/settings">
          {children}
        </GlobalFileDropProvider>
      </WorkosAuthBoundary>
    </ConvexClientProvider>
  );
}
