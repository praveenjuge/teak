import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import Link from "next/link";
import { Suspense } from "react";
import { AuthRouteGuard } from "@/components/AuthRouteGuard";
import { AuthCardLoading } from "./AuthCardLoading";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthScreenShell
      logo={
        <Link href="/login">
          <Logo variant="primary" />
        </Link>
      }
    >
      <Suspense fallback={<AuthCardLoading />}>
        <AuthRouteGuard fallback={<AuthCardLoading />}>
          {children}
        </AuthRouteGuard>
      </Suspense>
    </AuthScreenShell>
  );
}
