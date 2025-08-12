"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Dashboard } from "@/components/Dashboard";
import { RedirectToSignIn } from "@clerk/clerk-react";
import { Loading } from "@/components/Loading";

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 pb-10">
      <AuthLoading>
        <Loading fullScreen={true} />
      </AuthLoading>
      <Authenticated>
        <Dashboard />
      </Authenticated>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
    </main>
  );
}
