import { GlobalFileDropProvider } from "@teak/ui/hooks/GlobalFileDropProvider";
import {
  type NoUserInfo,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { readSidebarCookies } from "./AppShellFrame";
import { AppShellSkeleton } from "./AppShellSkeleton";
import { AuthUnavailable } from "./AuthUnavailable";
import ConvexClientProvider from "./ConvexClientProvider";
import { PostHogIdentify } from "./PostHogIdentify";
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

  // Until the vault opens (on the client), the page shows its frame: this
  // is what the server renders, so it is the page's first paint.
  const sidebar = await readSidebarCookies();
  return (
    <ConvexClientProvider initialAuth={initialAuth}>
      <WorkosAuthBoundary loading={<AppShellSkeleton {...sidebar} />}>
        <PostHogIdentify />
        <WebMcpTools />
        <GlobalFileDropProvider upgradeUrl="/settings">
          {children}
        </GlobalFileDropProvider>
      </WorkosAuthBoundary>
    </ConvexClientProvider>
  );
}
