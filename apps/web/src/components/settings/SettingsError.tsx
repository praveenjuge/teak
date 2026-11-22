import type { ErrorComponentProps } from "@tanstack/react-router";
import { PageErrorScreen } from "@/components/feedback/PageErrorScreen";

/** A settings page that failed, inside the settings shell. */
export function SettingsError({ error }: ErrorComponentProps) {
  return (
    <PageErrorScreen
      boundary="settings"
      error={error as Error}
      withSidebarToggle={false}
    />
  );
}
