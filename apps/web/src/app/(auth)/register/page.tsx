"use client";

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
import { AppleIcon, GoogleIcon } from "@teak/ui/icons";
import { cn } from "@teak/ui/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export default function SignUp() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const nextPath = useMemo(() => {
    const rawValue = searchParams.get("next");
    if (!(rawValue?.startsWith("/") && !rawValue.startsWith("//"))) {
      return "/";
    }
    return rawValue;
  }, [searchParams]);

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("teak-verify-alert");
    const storedEmail = sessionStorage.getItem("teak-verify-email");
    if (shouldShow) {
      if (storedEmail) {
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
    setGoogleLoading(true);
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
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
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
    } finally {
      setAppleLoading(false);
    }
  };

  const showPasswordTooShort =
    passwordTouched && password.length > 0 && password.length < 8;

  return (
    <>
      <CardTitle className="text-center text-lg">Get started on Teak</CardTitle>
      <CardContent>
        <div className="grid gap-2">
          <Button
            className="w-full"
            disabled={loading || googleLoading || appleLoading}
            onClick={handleGoogleSignIn}
            type="button"
            variant="outline"
          >
            {googleLoading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <>
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </>
            )}
          </Button>

          <Button
            className="w-full"
            disabled={loading || googleLoading || appleLoading}
            onClick={handleAppleSignIn}
            type="button"
            variant="outline"
          >
            {appleLoading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <>
                <AppleIcon className="h-4 w-4" />
                Continue with Apple
              </>
            )}
          </Button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();

            // Validate password length
            if (password.length < 8) {
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
                  setLoading(true);
                },
                onResponse: () => {
                  setLoading(false);
                },
                onError: (ctx) => {
                  setLoading(false);
                  const message =
                    ctx.error?.message ?? "Failed to create account";
                  toast.error(message, MANUAL_CLOSE_TOAST_OPTIONS);
                },
                onSuccess: async () => {
                  setLoading(false);
                  toast.success(`Verification email sent to ${email}.`, {
                    ...AUTH_STICKY_TOAST_OPTIONS,
                  });
                  sessionStorage.setItem("teak-verify-alert", "1");
                  sessionStorage.setItem("teak-verify-email", email);
                },
              }
            );
          }}
        >
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
            disabled={
              loading || password.length < 8 || googleLoading || appleLoading
            }
            type="submit"
          >
            {loading ? <Spinner /> : "Create an account"}
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
