"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Dashboard } from "@/components/Dashboard";
import { Loader2Icon } from "lucide-react";
import { RedirectToSignIn } from "@clerk/clerk-react";

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 pb-10">
      <AuthLoading>
        <div className="grid place-items-center min-h-screen w-full">
          <Loader2Icon className="animate-spin text-muted-foreground" />
        </div>
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
