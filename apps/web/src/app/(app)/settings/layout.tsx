import type { ReactNode } from "react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsShell } from "@/screens";
import { SettingsProvider } from "./SettingsProvider";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SettingsShell header={<SettingsHeader />} nav={<SettingsNav />}>
        {children}
      </SettingsShell>
    </SettingsProvider>
  );
}
