"use client";

import { Authenticated, AuthLoading } from "convex/react";
import { Dashboard } from "@/components/Dashboard";
import { Loading } from "@/components/Loading";

export const experimental_ppr = true;

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 pb-10">
      <AuthLoading>
        <Loading fullScreen={true} />
      </AuthLoading>
      <Authenticated>
        <Dashboard />
      </Authenticated>
    </main>
  );
}
