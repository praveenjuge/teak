import type { ReactNode } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { TopPattern } from "@/components/patterns/TopPattern";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between">
        <Link
          href="/"
          className="flex items-center"
          aria-label="Return to dashboard"
        >
          <Logo variant="primary" />
        </Link>
        <UserProfileDropdown />
      </header>
      <section className="max-w-3xl mx-auto space-y-4">
        <SettingsSidebarNav />
        <section className="border bg-background p-4 rounded-lg sm:p-8 w-full">
          {children}
        </section>
      </section>

      <TopPattern />
    </>
  );
}
