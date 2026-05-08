import { SettingsShell } from "@teak/ui/screens";
import Link from "next/link";
import type { ReactNode } from "react";
import AuthenticatedAppProvider from "@/components/AuthenticatedAppProvider";

// Override the root layout's `force-static` so that `headers()` (used by
// `getToken()` in `AuthenticatedAppProvider`) returns real request headers and
// SSR token preloading can actually work.
export const dynamic = "force-dynamic";

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
