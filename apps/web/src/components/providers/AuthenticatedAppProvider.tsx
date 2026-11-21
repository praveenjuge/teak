import type { ReactNode } from "react";
import { GlobalFileDropProvider } from "@/components/providers/GlobalFileDropProvider";
import type { AppSessionResult } from "@/lib/appSession";
import { AppShellSkeleton } from "../app-shell/AppShellSkeleton";
import { WebMcpTools } from "../app-shell/WebMcpTools";
import { AccountLocaleSync } from "./AccountLocaleSync";
import { AuthUnavailable } from "./AuthUnavailable";
import ConvexClientProvider from "./ConvexClientProvider";
import { LocaleProvider } from "./LocaleProvider";
import { WorkosAuthBoundary } from "./WorkosAuthBoundary";

/** The providers every signed-in page sits in, fed by `loadAppSession`. */
export default function AuthenticatedAppProvider({
  children,
  loading,
  session,
}: {
  children: ReactNode;
  loading?: ReactNode;
  session: AppSessionResult;
}) {
  if ("unavailable" in session) {
    return <AuthUnavailable />;
  }
  return (
    <LocaleProvider
      initialLocale={session.locale}
      initialMessages={session.messages}
    >
      <ConvexClientProvider
        initialAuth={session.initialAuth}
        initialToken={session.accessToken}
        seeds={session.seeds}
      >
        <WorkosAuthBoundary
          loading={loading ?? <AppShellSkeleton {...session.sidebar} />}
        >
          <AccountLocaleSync />
          <WebMcpTools />
          <GlobalFileDropProvider>{children}</GlobalFileDropProvider>
        </WorkosAuthBoundary>
      </ConvexClientProvider>
    </LocaleProvider>
  );
}
