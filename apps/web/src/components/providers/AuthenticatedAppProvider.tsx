import { LOCALE_COOKIE, loadMessages } from "@teak/i18n";
import {
  type NoUserInfo,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { GlobalFileDropProvider } from "@/components/providers/GlobalFileDropProvider";
import { localeFromCookie } from "@/lib/locale";
import { readSidebarCookies } from "../app-shell/AppShellFrame";
import { AppShellSkeleton } from "../app-shell/AppShellSkeleton";
import { WebMcpTools } from "../app-shell/WebMcpTools";
import { AccountLocaleSync } from "./AccountLocaleSync";
import { AuthUnavailable } from "./AuthUnavailable";
import ConvexClientProvider from "./ConvexClientProvider";
import { LocaleProvider } from "./LocaleProvider";
import { WorkosAuthBoundary } from "./WorkosAuthBoundary";

export default async function AuthenticatedAppProvider({
  children,
  loading,
}: {
  children: ReactNode;
  /** What shows while the session loads; the app shell's skeleton by default. */
  loading?: ReactNode;
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
  const locale = localeFromCookie((await cookies()).get(LOCALE_COOKIE)?.value);
  const messages = await loadMessages(locale);
  return (
    <LocaleProvider initialLocale={locale} initialMessages={messages}>
      <ConvexClientProvider initialAuth={initialAuth}>
        <WorkosAuthBoundary
          loading={loading ?? <AppShellSkeleton {...sidebar} />}
        >
          <AccountLocaleSync />
          <WebMcpTools />
          <GlobalFileDropProvider upgradeUrl="/settings">
            {children}
          </GlobalFileDropProvider>
        </WorkosAuthBoundary>
      </ConvexClientProvider>
    </LocaleProvider>
  );
}
