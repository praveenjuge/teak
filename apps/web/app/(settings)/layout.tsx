"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { TopPattern } from "@/components/patterns/TopPattern";
import { Authenticated, AuthLoading } from "convex/react";
import Loading from "../loading";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <Loading />
      </AuthLoading>
      <Authenticated>
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
        <section className="max-w-2xl mx-auto -space-y-px">
          <SettingsSidebarNav />
          <section className="border bg-background rounded-b-lg rounded-tr-lg p-7 w-full space-y-7">
            {children}
          </section>
        </section>
      </Authenticated>

      <TopPattern />
    </>
  );
}
