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
import { Spinner } from "@teak/ui/components/ui/spinner";
import {
  AUTH_STICKY_TOAST_OPTIONS,
  MANUAL_CLOSE_TOAST_OPTIONS,
} from "@teak/ui/constants/toast";
import { cn } from "@teak/ui/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { getSafeNextPath } from "@/lib/safe-next-path";

const MIN_PASSWORD_LENGTH = 8;
type PendingProvider = "email" | "google" | "apple" | null;

export default function SignUp() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [pending, setPending] = useState<PendingProvider>(null);

  const nextPath = getSafeNextPath(searchParams.get("next")) ?? "/";
  const isBusy = pending !== null;

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("teak-verify-alert");
    const storedEmail = sessionStorage.getItem("teak-verify-email");
    if (shouldShow) {
      if (storedEmail) {
        // Prefill from sessionStorage in an effect (not a lazy initializer) to
        // keep server and first client render identical and avoid a hydration
        // mismatch on the controlled email input.
        // react-doctor-disable-next-line react-doctor/no-initialize-state, react-hooks-js/set-state-in-effect
        setEmail(storedEmail);
        toast.success(`Verification email sent to ${storedEmail}.`, {
          ...AUTH_STICKY_TOAST_OPTIONS,
        });
      }
      sessionStorage.removeItem("teak-verify-alert");
      sessionStorage.removeItem("teak-verify-email");
    }
  }, []);

  const handleGoogleSignIn = async () => {
    setPending("google");
    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      });
      if (response?.error) {
        toast.error(
          response.error.message ??
            "Failed to sign in with Google. Please try again.",
          MANUAL_CLOSE_TOAST_OPTIONS
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Google";
      toast.error(errorMessage);
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
        toast.error(
          response.error.message ??
            "Failed to sign in with Apple. Please try again."
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Apple";
      toast.error(errorMessage, MANUAL_CLOSE_TOAST_OPTIONS);
    }
    setPending(null);
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate password length
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(
        "Password must be at least 8 characters long",
        MANUAL_CLOSE_TOAST_OPTIONS
      );
      return;
    }

    const derivedName = email.trim().split("@")[0]?.trim() || "User";

    await authClient.signUp.email(
      {
        email,
        password,
        name: derivedName,
      },
      {
        onRequest: () => {
          setPending("email");
        },
        onResponse: () => {
          setPending(null);
        },
        onError: (ctx) => {
          setPending(null);
          const message = ctx.error?.message ?? "Failed to create account";
          toast.error(message, MANUAL_CLOSE_TOAST_OPTIONS);
        },
        onSuccess: () => {
          setPending(null);
          toast.success(`Verification email sent to ${email}.`, {
            ...AUTH_STICKY_TOAST_OPTIONS,
          });
          sessionStorage.setItem("teak-verify-alert", "1");
          sessionStorage.setItem("teak-verify-email", email);
        },
      }
    );
  };

  const showPasswordTooShort =
    passwordTouched &&
    password.length > 0 &&
    password.length < MIN_PASSWORD_LENGTH;

  return (
    <>
      <CardTitle className="text-center text-lg">Get started on Teak</CardTitle>
      <CardContent>
        <SocialAuthButtons
          appleLoading={pending === "apple"}
          disabled={isBusy}
          googleLoading={pending === "google"}
          onAppleSignIn={() => void handleAppleSignIn()}
          onGoogleSignIn={() => void handleGoogleSignIn()}
        />

        <AuthDivider />

        <form className="grid gap-4" onSubmit={handleEmailSignUp}>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
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
            <Label htmlFor="password">Password</Label>
            <Input
              autoComplete="new-password"
              className={showPasswordTooShort ? "border-destructive" : ""}
              id="password"
              onBlur={() => setPasswordTouched(true)}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              type="password"
              value={password}
            />
            {showPasswordTooShort && (
              <p className="text-destructive text-sm">
                Password must be at least 8 characters long
              </p>
            )}
          </div>

          <Button
            className="w-full"
            disabled={isBusy || password.length < MIN_PASSWORD_LENGTH}
            type="submit"
          >
            {pending === "email" ? <Spinner /> : "Create an account"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="-my-2 flex-col gap-1">
        <Link
          className={cn(buttonVariants({ variant: "link" }))}
          href={
            nextPath === "/"
              ? "/login"
              : `/login?next=${encodeURIComponent(nextPath)}`
          }
        >
          Already have an account? Login
        </Link>
      </CardFooter>
    </>
  );
}
