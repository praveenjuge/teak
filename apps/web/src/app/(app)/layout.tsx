import { type ReactNode, Suspense } from "react";
import { AppLoadingShell } from "@/components/app-shell/AppLoadingShell";
import { AppShellFrame } from "@/components/app-shell/AppShellFrame";
import AuthenticatedAppProvider from "@/components/providers/AuthenticatedAppProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppLoadingShell />}>
      <AuthenticatedAppProvider>
        <AppShellFrame>{children}</AppShellFrame>
      </AuthenticatedAppProvider>
    </Suspense>
  );
}
