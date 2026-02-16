"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppleIcon } from "@/components/icons/AppleIcon";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { CardContent, CardFooter, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { metrics } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextPath = useMemo(() => {
    const rawValue = searchParams.get("next");
    if (!(rawValue?.startsWith("/") && !rawValue.startsWith("//"))) {
      return "/";
    }
    return rawValue;
  }, [searchParams]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      });
      if (response?.error) {
        metrics.loginFailed("google", response.error.message);
        setError(
          response.error.message ??
            "Failed to sign in with Google. Please try again."
        );
      } else {
        metrics.loginSuccess("google");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Google";
      metrics.loginFailed("google", errorMessage);
      setError(errorMessage);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    setAppleLoading(true);
    try {
      const response = await authClient.signIn.social({
        provider: "apple",
        callbackURL: nextPath,
      });
      if (response?.error) {
        metrics.loginFailed("apple", response.error.message);
        setError(
          response.error.message ??
            "Failed to sign in with Apple. Please try again."
        );
      } else {
        metrics.loginSuccess("apple");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Apple";
      metrics.loginFailed("apple", errorMessage);
      setError(errorMessage);
    } finally {
      setAppleLoading(false);
    }
  };

  return (
    <>
      <CardTitle className="text-center text-lg">Login to Teak</CardTitle>
      <CardContent>
        {error && (
          <Alert className="mb-4" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

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
            setError(null);
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
                  metrics.loginSuccess("email");
                  router.push(nextPath);
                },
                onError: (ctx) => {
                  setLoading(false);
                  const errorMessage =
                    ctx.error?.message ?? "Invalid email or password";
                  metrics.loginFailed("email", errorMessage);

                  // Check if the error is related to email verification
                  if (
                    errorMessage.toLowerCase().includes("verification") ||
                    errorMessage.toLowerCase().includes("verify") ||
                    errorMessage.toLowerCase().includes("unverified")
                  ) {
                    setError(
                      "Please check your email and click the verification link before signing in. If you didn't receive the email, check your spam folder."
                    );
                  } else {
                    setError(errorMessage);
                  }
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
