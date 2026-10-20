import { SettingsContentSkeleton } from "@/components/settings/SettingsContentSkeleton";
import { SettingsShell } from "@/screens/SettingsShell";
import { SettingsHeader } from "./SettingsBackLink";

export function SettingsPageSkeleton() {
  return (
    <div className="flow-root">
      <SettingsShell header={<SettingsHeader />}>
        <SettingsContentSkeleton />
      </SettingsShell>
    </div>
  );
}
