"use client";

import { usePathname } from "next/navigation";
import { PageLoadingState } from "@/components/feedback/PageLoadingState";
import { SettingsPageSkeleton } from "../settings/SettingsPageSkeleton";

export function AppLoading({ fullscreen }: { fullscreen: boolean }) {
  const pathname = usePathname();
  if (fullscreen && pathname.startsWith("/settings")) {
    return (
      <div data-slot="page-loading">
        <SettingsPageSkeleton />
      </div>
    );
  }
  return <PageLoadingState fullScreen={fullscreen} />;
}
