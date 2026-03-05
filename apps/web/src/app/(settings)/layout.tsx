"use client";

import { SettingsShell } from "@teak/ui/screens";
import Link from "next/link";
import type { ReactNode } from "react";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsShell
      backControl={
        <Link className="inline-block font-medium text-primary" href="/">
          &larr; Back
        </Link>
      }
    >
      {children}
    </SettingsShell>
  );
}
