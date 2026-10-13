import { type ReactNode, Suspense } from "react";
import { AppShellFrame } from "@/components/AppShellFrame";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";
import Loading from "../loading";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <AuthenticatedAppProvider>
        <AppShellFrame>{children}</AppShellFrame>
      </AuthenticatedAppProvider>
    </Suspense>
  );
}
