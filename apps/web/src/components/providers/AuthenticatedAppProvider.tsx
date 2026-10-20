import {
  type NoUserInfo,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { GlobalFileDropProvider } from "@/hooks/GlobalFileDropProvider";
import { readSidebarCookies } from "../app-shell/AppShellFrame";
import { AppShellSkeleton } from "../app-shell/AppShellSkeleton";
import { WebMcpTools } from "../app-shell/WebMcpTools";
import { AuthUnavailable } from "./AuthUnavailable";
import ConvexClientProvider from "./ConvexClientProvider";
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

  const sidebar = await readSidebarCookies();
  return (
    <ConvexClientProvider initialAuth={initialAuth}>
      <WorkosAuthBoundary loading={<AppShellSkeleton {...sidebar} />}>
        <WebMcpTools />
        <GlobalFileDropProvider upgradeUrl="/settings">
          {children}
        </GlobalFileDropProvider>
      </WorkosAuthBoundary>
    </ConvexClientProvider>
  );
}
