"use client";

import { usePathname } from "next/navigation";
import { PageLoadingState } from "@/components/feedback/PageLoadingState";
import { isSettingsPath } from "@/lib/settingsSections";
import { SettingsPageSkeleton } from "../settings/SettingsPageSkeleton";

export function AppLoading({ fullscreen }: { fullscreen: boolean }) {
  const pathname = usePathname();
  if (fullscreen && isSettingsPath(pathname)) {
    return (
      <div data-slot="page-loading">
        <SettingsPageSkeleton />
      </div>
    );
  }
  return <PageLoadingState fullScreen={fullscreen} />;
}
