import { SettingsPageClient } from "./SettingsPageClient";

// The app layout waits on the session check (AuthenticatedAppProvider), so
// navigations here are allowed to block; dev's instant validation skips them.
export const instant = false;

export default function SettingsPage() {
  return <SettingsPageClient />;
}
