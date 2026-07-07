"use client";

import { AuthDivider, SocialAuthButtons } from "@teak/ui/auth";
import { Button, buttonVariants } from "@teak/ui/components/ui/button";
import {
  CardContent,
  CardFooter,
  CardTitle,
} from "@teak/ui/components/ui/card";
import { Input } from "@teak/ui/components/ui/input";
import { Label } from "@teak/ui/components/ui/label";
import { AUTH_STICKY_TOAST_OPTIONS } from "@teak/ui/constants/toast";
import { cn } from "@teak/ui/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { resolveAuthRedirect } from "@/lib/auth-redirect";
import { AuthCardLoading } from "../AuthCardLoading";

type PendingProvider = "email" | "google" | "apple" | null;

function showSignInError(message: string) {
  const normalizedMessage = message.toLowerCase();
  const isVerificationError =
    normalizedMessage.includes("verification") ||
    normalizedMessage.includes("verify") ||
    normalizedMessage.includes("unverified");

  if (isVerificationError) {
    toast.error(
      "Please check your email (including the spam folder) and click the verification link before signing in.",
      AUTH_STICKY_TOAST_OPTIONS
    );
    return;
  }

  toast.error(message);
}

export default function SignIn() {
  return (
    <Suspense fallback={<AuthCardLoading />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<PendingProvider>(null);

  const { nextPath, isOAuthAuthorize } = resolveAuthRedirect(searchParams);
  const isBusy = pending !== null;

  const handleGoogleSignIn = async () => {
    setPending("google");
    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      });
      if (response?.error) {
        showSignInError(
          response.error.message ??
            "Failed to sign in with Google. Please try again."
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Google";
      showSignInError(errorMessage);
    }
    setPending(null);
  };

  const handleAppleSignIn = async () => {
    setPending("apple");
    try {
      const response = await authClient.signIn.social({
        provider: "apple",
        callbackURL: nextPath,
      });
      if (response?.error) {
        showSignInError(
          response.error.message ??
            "Failed to sign in with Apple. Please try again."
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Apple";
      showSignInError(errorMessage);
    }
    setPending(null);
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending("email");
    try {
      const response = await authClient.signIn.email({
        email,
        password,
      });

      if (response.error) {
        showSignInError(response.error.message ?? "Invalid email or password");
        setPending(null);
        return;
      }

      window.location.replace(
        new URL(nextPath, window.location.origin).toString()
      );
    } catch (err) {
      setPending(null);
      showSignInError(
        err instanceof Error ? err.message : "Invalid email or password"
      );
    }
  };

  return (
    <>
      <CardTitle className="text-center text-lg">Login to Teak</CardTitle>
      {isOAuthAuthorize && (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-center text-muted-foreground text-sm">
          An app is requesting access to your Teak account. Sign in to continue.
        </p>
      )}
      <CardContent>
        <SocialAuthButtons
          appleLoading={pending === "apple"}
          disabled={isBusy}
          googleLoading={pending === "google"}
          onAppleSignIn={() => void handleAppleSignIn()}
          onGoogleSignIn={() => void handleGoogleSignIn()}
        />

        <AuthDivider />

        <form className="grid gap-4" onSubmit={handleEmailSignIn}>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              autoComplete="email"
              id="email"
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="me@example.com"
              required
              type="email"
              value={email}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                className={cn(
                  buttonVariants({ variant: "link" }),
                  "h-auto p-0"
                )}
                href={
                  nextPath === "/"
                    ? "/forgot-password"
                    : `/forgot-password?next=${encodeURIComponent(nextPath)}`
                }
              >
                Forgot?
              </Link>
            </div>

            <Input
              autoComplete="current-password"
              id="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              type="password"
              value={password}
            />
          </div>

          <Button className="w-full" disabled={isBusy} type="submit">
            {pending === "email" ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <p> Login </p>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="-my-2 flex-col">
        <Link
          className={cn(buttonVariants({ variant: "link" }))}
          href={
            nextPath === "/"
              ? "/register"
              : `/register?next=${encodeURIComponent(nextPath)}`
          }
        >
          New User? Register
        </Link>
      </CardFooter>
    </>
  );
}
