"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { TopPattern } from "@/components/patterns/TopPattern";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto my-10 w-full max-w-md space-y-5">
      <Link className="inline-block font-medium text-primary" href="/">
        &larr; Back
      </Link>
      <div className="space-y-5 rounded-lg border bg-background p-7">
        {children}
      </div>
      <TopPattern />
    </section>
  );
}
