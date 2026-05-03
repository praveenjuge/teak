"use client";

import { Button, buttonVariants } from "@teak/ui/components/ui/button";
import {
  CardContent,
  CardFooter,
  CardTitle,
} from "@teak/ui/components/ui/card";
import { Input } from "@teak/ui/components/ui/input";
import { Label } from "@teak/ui/components/ui/label";
import { AUTH_STICKY_TOAST_OPTIONS } from "@teak/ui/constants/toast";
import { AppleIcon, GoogleIcon } from "@teak/ui/icons";
import { cn } from "@teak/ui/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const nextPath = useMemo(() => {
    const rawValue = searchParams.get("next");
    if (!(rawValue?.startsWith("/") && !rawValue.startsWith("//"))) {
      return "/";
    }
    return rawValue;
  }, [searchParams]);

  const showSignInError = (message: string) => {
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
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
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
        showSignInError(
          response.error.message ??
            "Failed to sign in with Apple. Please try again."
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Apple";
      showSignInError(errorMessage);
    } finally {
      setAppleLoading(false);
    }
  };

  return (
    <>
      <CardTitle className="text-center text-lg">Login to Teak</CardTitle>
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
          <div className="relative flex justify-center">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await authClient.signIn.email(
              {
                email,
                password,
                callbackURL: nextPath,
              },
              {
                onRequest: () => {
                  setLoading(true);
                },
                onResponse: () => {
                  setLoading(false);
                },
                onSuccess: () => {
                  setLoading(false);
                  router.push(nextPath);
                },
                onError: (ctx) => {
                  setLoading(false);
                  const errorMessage =
                    ctx.error?.message ?? "Invalid email or password";
                  showSignInError(errorMessage);
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
              autoComplete="password"
              id="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              type="password"
              value={password}
            />
          </div>

          <Button
            className="w-full"
            disabled={loading || googleLoading || appleLoading}
            type="submit"
          >
            {loading ? (
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
