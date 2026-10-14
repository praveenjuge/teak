import { SettingsShell } from "@teak/ui/screens";
import type { ReactNode } from "react";
import { SettingsHeader } from "@/components/SettingsBackLink";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell header={<SettingsHeader />}>{children}</SettingsShell>;
}
