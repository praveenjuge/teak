import { GlobalFileDropProvider } from "@teak/ui/hooks/GlobalFileDropProvider";
import {
  type NoUserInfo,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type { PublicAuthMode } from "@/lib/auth-mode";
import { readAuthMode } from "@/lib/auth-mode-server";
import { getToken } from "@/lib/auth-server";
import { AuthUnavailable } from "./AuthUnavailable";
import { ClientAuthBoundary } from "./ClientAuthBoundary";
import ConvexClientProvider from "./ConvexClientProvider";
import { PublicAuthProvider } from "./PublicAuthProvider";
import { SentryUserManager } from "./SentryUserManager";
import { WebMcpTools } from "./WebMcpTools";

export default async function AuthenticatedAppProvider({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  let mode: PublicAuthMode;
  let initialToken: string | null | undefined;
  let initialAuth: Omit<UserInfo | NoUserInfo, "accessToken"> | undefined;
  try {
    mode = await readAuthMode();
    initialToken = mode.primary === "betterauth" ? await getToken() : null;
    if (mode.primary === "workos") {
      const { accessToken: _accessToken, ...session } = await withAuth();
      initialAuth = session;
    }
  } catch {
    return <AuthUnavailable />;
  }

  return (
    <PublicAuthProvider>
      <ConvexClientProvider
        initialAuth={initialAuth}
        initialMode={mode}
        initialToken={initialToken}
      >
        <AuthenticatedContents primary={mode.primary}>
          {children}
        </AuthenticatedContents>
      </ConvexClientProvider>
    </PublicAuthProvider>
  );
}

function AuthenticatedContents({
  primary,
  children,
}: {
  primary: PublicAuthMode["primary"];
  children: ReactNode;
}) {
  return (
    <ClientAuthBoundary primary={primary}>
      <SentryUserManager />
      <WebMcpTools />
      <GlobalFileDropProvider upgradeUrl="/settings">
        {children}
      </GlobalFileDropProvider>
    </ClientAuthBoundary>
  );
}
