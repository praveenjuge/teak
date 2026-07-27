import { SettingsShell } from "@teak/ui/screens";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";
import Loading from "../loading";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsShell
      backControl={
        <Link className="inline-block font-medium text-primary" href="/">
          &larr; Back
        </Link>
      }
    >
      <Suspense fallback={<Loading fullscreen={false} />}>
        <AuthenticatedAppProvider>{children}</AuthenticatedAppProvider>
      </Suspense>
    </SettingsShell>
  );
}
