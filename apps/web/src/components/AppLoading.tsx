"use client";

import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { usePathname } from "next/navigation";
import { SettingsPageSkeleton } from "./SettingsPageSkeleton";

export function AppLoading({ fullscreen }: { fullscreen: boolean }) {
  const pathname = usePathname();
  if (fullscreen && pathname?.startsWith("/settings")) {
    return (
      <div data-slot="page-loading">
        <SettingsPageSkeleton />
      </div>
    );
  }
  return <PageLoadingState fullScreen={fullscreen} />;
}
