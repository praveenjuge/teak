import type { ReactNode } from "react";
import { Suspense } from "react";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";

export default function OAuthConsentLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <AuthenticatedAppProvider>{children}</AuthenticatedAppProvider>
    </Suspense>
  );
}
