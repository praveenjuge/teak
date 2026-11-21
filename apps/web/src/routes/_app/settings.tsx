import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { SettingsShell } from "@/components/settings/SettingsShell";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <SettingsProvider>
      <SettingsShell header={<SettingsHeader />} nav={<SettingsNav />}>
        <Outlet />
      </SettingsShell>
    </SettingsProvider>
  );
}
