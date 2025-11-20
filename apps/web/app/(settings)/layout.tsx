"use client";

import type { ReactNode } from "react";
import { TopPattern } from "@/components/patterns/TopPattern";
import { Authenticated, AuthLoading } from "convex/react";
import Loading from "@/app/loading";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <Loading />
      </AuthLoading>

      <Authenticated>
        <section className="max-w-lg mx-auto border bg-background rounded-lg p-7 w-full space-y-5 my-10 relative">
          {children}
        </section>
      </Authenticated>

      <TopPattern />
    </>
  );
}
