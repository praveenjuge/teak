"use client";

import { Authenticated, Unauthenticated } from "convex/react";
import { SignUpButton, SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <>
      <main className="min-h-screen bg-gray-50">
        <Authenticated>
          <Dashboard />
        </Authenticated>
        <Unauthenticated>
          <div className="flex flex-col gap-8 max-w-md mx-auto p-8 pt-16">
            <SignInForm />
          </div>
        </Unauthenticated>
      </main>
    </>
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

