import { SettingsShell } from "@teak/ui/screens";
import type { ReactNode } from "react";
import { SettingsBackLink } from "@/components/SettingsBackLink";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsShell backControl={<SettingsBackLink />}>{children}</SettingsShell>
  );
}
