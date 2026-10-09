"use client";

import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { SettingsShell } from "@teak/ui/screens/SettingsShell";
import { SettingsContentSkeleton } from "@teak/ui/settings/SettingsContentSkeleton";
import { usePathname } from "next/navigation";
import { SettingsBackLink } from "./SettingsBackLink";

// While the session loads, /settings shows its own card frame in place so the
// real content swaps in without the page jumping from a centered spinner.
export function AppLoading({ fullscreen }: { fullscreen: boolean }) {
  const pathname = usePathname();
  if (fullscreen && pathname?.startsWith("/settings")) {
    return (
      <div className="contents" data-slot="page-loading">
        <SettingsShell backControl={<SettingsBackLink />}>
          <SettingsContentSkeleton />
        </SettingsShell>
      </div>
    );
  }
  return <PageLoadingState fullScreen={fullscreen} />;
}
