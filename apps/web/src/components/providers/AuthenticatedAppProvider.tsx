import { LOCALE_COOKIE, loadMessages } from "@teak/i18n";
import {
  type NoUserInfo,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { GlobalFileDropProvider } from "@/components/providers/GlobalFileDropProvider";
import type { QuerySeed } from "@/lib/firstLoadQueries";
import { fetchFirstLoadSeeds } from "@/lib/firstLoadSeeds";
import { localeFromCookie } from "@/lib/locale";
import { SETTINGS_PLAN_HREF } from "@/lib/settingsSections";
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
  let accessToken: string | undefined;
  try {
    ({ accessToken, ...initialAuth } = await withAuth());
  } catch {
    return <AuthUnavailable />;
  }

  // The proxy names the requested URL; a layout has no other way to know it.
  const href = (await headers()).get("x-url");
  const locale = localeFromCookie((await cookies()).get(LOCALE_COOKIE)?.value);
  const [seeds, sidebar, messages] = await Promise.all([
    initialAuth.user && accessToken && href
      ? fetchFirstLoadSeeds(href, accessToken)
      : ([] as QuerySeed[]),
    readSidebarCookies(),
    loadMessages(locale),
  ]);
  return (
    <LocaleProvider initialLocale={locale} initialMessages={messages}>
      <ConvexClientProvider initialAuth={initialAuth} seeds={seeds}>
        <WorkosAuthBoundary
          loading={loading ?? <AppShellSkeleton {...sidebar} />}
        >
          <AccountLocaleSync />
          <WebMcpTools />
          <GlobalFileDropProvider upgradeUrl={SETTINGS_PLAN_HREF}>
            {children}
          </GlobalFileDropProvider>
        </WorkosAuthBoundary>
      </ConvexClientProvider>
    </LocaleProvider>
  );
}
