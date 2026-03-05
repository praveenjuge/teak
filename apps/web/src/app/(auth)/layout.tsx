import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import Link from "next/link";

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
      {children}
    </AuthScreenShell>
  );
}
