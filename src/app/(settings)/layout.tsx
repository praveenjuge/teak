"use client";

import type { ReactNode } from "react";
import { TopPattern } from "@/components/patterns/TopPattern";
import Link from "next/link";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <section className="max-w-md mx-auto w-full space-y-5 my-10">
      <Link href="/" className="text-primary inline-block font-medium">
        &larr; Back
      </Link>
      <div className="border bg-background rounded-lg p-7 space-y-5">
        {children}
      </div>
      <TopPattern />
    </section>
  );
}
