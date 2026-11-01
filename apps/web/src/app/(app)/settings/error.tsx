"use client";

import { SegmentErrorScreen } from "@/components/feedback/SegmentErrorScreen";

export default function SettingsError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <SegmentErrorScreen
      boundary="settings"
      error={error}
      withSidebarToggle={false}
    />
  );
}
