"use client";

import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { SettingsShell } from "@teak/ui/screens/SettingsShell";
import { SettingsContentSkeleton } from "@teak/ui/settings/SettingsContentSkeleton";
import { usePathname } from "next/navigation";
import { SettingsHeader } from "./SettingsBackLink";

// While the session loads, /settings shows its own card frame in place so the
// real content swaps in without the page jumping from a centered spinner.
// flow-root keeps the card's top margin inside this frame, as the app shell's
// flex layout does, so the body doesn't shift when the shell replaces it.
export function AppLoading({ fullscreen }: { fullscreen: boolean }) {
  const pathname = usePathname();
  if (fullscreen && pathname?.startsWith("/settings")) {
    return (
      <div className="flow-root" data-slot="page-loading">
        <SettingsShell header={<SettingsHeader />}>
          <SettingsContentSkeleton />
        </SettingsShell>
      </div>
    );
  }
  return <PageLoadingState fullScreen={fullscreen} />;
}
