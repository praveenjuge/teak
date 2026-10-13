import { SettingsShell } from "@teak/ui/screens";
import { SidebarToggle } from "@teak/ui/sidebar";
import type { ReactNode } from "react";
import { SettingsBackLink } from "@/components/SettingsBackLink";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsShell
      backControl={
        <div className="flex items-center gap-2">
          {/* Phones reach the sidebar drawer here; desktop shows it. */}
          <SidebarToggle className="-ml-2 md:hidden" />
          <SettingsBackLink />
        </div>
      }
    >
      {children}
    </SettingsShell>
  );
}
