import { SettingsShell } from "@teak/ui/screens/SettingsShell";
import { SettingsContentSkeleton } from "@teak/ui/settings/SettingsContentSkeleton";
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
