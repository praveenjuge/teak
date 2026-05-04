import { SettingsShell } from "@teak/ui/screens";
import Link from "next/link";
import type { ReactNode } from "react";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedAppProvider>
      <SettingsShell
        backControl={
          <Link className="inline-block font-medium text-primary" href="/">
            &larr; Back
          </Link>
        }
      >
        {children}
      </SettingsShell>
    </AuthenticatedAppProvider>
  );
}
