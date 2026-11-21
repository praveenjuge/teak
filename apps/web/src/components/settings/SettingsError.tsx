import type { ErrorComponentProps } from "@tanstack/react-router";
import { SegmentErrorScreen } from "@/components/feedback/SegmentErrorScreen";

/** A settings page that failed, inside the settings shell. */
export function SettingsError({ error }: ErrorComponentProps) {
  return (
    <SegmentErrorScreen
      boundary="settings"
      error={error as Error}
      withSidebarToggle={false}
    />
  );
}
