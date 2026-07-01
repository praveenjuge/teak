import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import Link from "next/link";
import { Suspense } from "react";
import { AuthRouteGuard } from "@/components/AuthRouteGuard";

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
      <Suspense>
        <AuthRouteGuard>{children}</AuthRouteGuard>
      </Suspense>
    </AuthScreenShell>
  );
}
