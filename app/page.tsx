"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto p-4">
      <AuthLoading>
        <div className="flex flex-col gap-4 text-center min-h-screen justify-center items-center">
          <h2>Loading...</h2>
        </div>
      </AuthLoading>
      <Authenticated>
        <Dashboard />
      </Authenticated>
      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>
    </main>
  );
}

function SignInForm() {
  return (
    <div className="flex flex-col gap-4 text-center">
      <h2 className="text-2xl font-bold">Welcome!</h2>
      <SignInButton mode="modal">
        <Button>Sign In</Button>
      </SignInButton>
      <SignUpButton mode="modal">
        <Button>Sign Up</Button>
      </SignUpButton>
    </div>
  );
}
