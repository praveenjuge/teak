import type { ReactNode } from "react";
import { SettingsHeader } from "@/components/settings/SettingsBackLink";
import { SettingsShell } from "@/screens";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell header={<SettingsHeader />}>{children}</SettingsShell>;
}
