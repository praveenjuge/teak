"use client";

import { AlertCircle, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppleIcon } from "@/components/icons/AppleIcon";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { CardContent, CardFooter, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { metrics } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("teak-verify-alert");
    const storedEmail = sessionStorage.getItem("teak-verify-email");
    if (shouldShow) {
      setShowSuccessAlert(true);
      if (storedEmail) {
        setEmail(storedEmail);
      }
      sessionStorage.removeItem("teak-verify-alert");
      sessionStorage.removeItem("teak-verify-email");
    }
  }, []);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (response?.error) {
        metrics.registrationFailed("google", response.error.message);
        setError(
          response.error.message ??
            "Failed to sign in with Google. Please try again."
        );
      } else {
        metrics.registrationSuccess("google");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Google";
      metrics.registrationFailed("google", errorMessage);
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
        metrics.registrationFailed("apple", response.error.message);
        setError(
          response.error.message ??
            "Failed to sign in with Apple. Please try again."
        );
      } else {
        metrics.registrationSuccess("apple");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with Apple";
      metrics.registrationFailed("apple", errorMessage);
      setError(errorMessage);
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
        {error && (
          <Alert className="mb-4" variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {showSuccessAlert && (
          <Alert className="mb-4">
            <Mail />
            <div>
              <AlertTitle>Verify your email</AlertTitle>
              <AlertDescription>
                We just sent a verification link to {email || "your email"}.
                Please open it to activate your account.
              </AlertDescription>
            </div>
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
          <div className="relative flex justify-center text-sm">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setShowSuccessAlert(false);

            // Validate password length
            if (password.length < 8) {
              setError("Password must be at least 8 characters long");
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
                  metrics.registrationFailed("email", message);
                  setError(message);
                },
                onSuccess: async () => {
                  setLoading(false);
                  metrics.registrationSuccess("email");
                  setShowSuccessAlert(true);
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
        <Link className={cn(buttonVariants({ variant: "link" }))} href="/login">
          Already have an account? Login
        </Link>
      </CardFooter>
    </>
  );
}
