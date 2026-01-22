"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { CardContent, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { AppleIcon } from "@/components/icons/AppleIcon";
import { cn } from "@/lib/utils";
import { metrics } from "@/lib/metrics";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (response?.error) {
        metrics.loginFailed("google", response.error.message);
        setError(
          response.error.message ??
            "Failed to sign in with Google. Please try again.",
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
        callbackURL: "/",
      });
      if (response?.error) {
        metrics.loginFailed("apple", response.error.message);
        setError(
          response.error.message ??
            "Failed to sign in with Apple. Please try again.",
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
      <CardTitle className="text-lg text-center">Login to Teak</CardTitle>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={loading || googleLoading || appleLoading}
          >
            {googleLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleAppleSignIn}
            disabled={loading || googleLoading || appleLoading}
          >
            {appleLoading ? (
              <Loader2 size={16} className="animate-spin" />
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
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            await authClient.signIn.email(
              {
                email,
                password,
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
                  router.push("/");
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
                      "Please check your email and click the verification link before signing in. If you didn't receive the email, check your spam folder.",
                    );
                  } else {
                    setError(errorMessage);
                  }
                },
              },
            );
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="me@example.com"
              required
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              value={email}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className={cn(
                  buttonVariants({ variant: "link" }),
                  "p-0 h-auto",
                )}
              >
                Forgot?
              </Link>
            </div>

            <Input
              id="password"
              type="password"
              placeholder="Password"
              autoComplete="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || googleLoading || appleLoading}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <p> Login </p>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col -my-2">
        <Link
          href="/register"
          className={cn(buttonVariants({ variant: "link" }))}
        >
          New User? Register
        </Link>
      </CardFooter>
    </>
  );
}
