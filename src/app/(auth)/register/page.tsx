"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import { AlertCircle, Mail } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { Spinner } from "@/components/ui/spinner";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { metrics } from "@/lib/metrics";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("teak-verify-alert");
    const storedEmail = sessionStorage.getItem("teak-verify-email");
    if (shouldShow) {
      setShowSuccessAlert(true);
      if (storedEmail) setEmail(storedEmail);
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

  const showPasswordTooShort =
    passwordTouched && password.length > 0 && password.length < 8;

  return (
    <>
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Register</CardTitle>
        <CardDescription>
          Enter your information to create an account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
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
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={loading || googleLoading}
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

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-card px-2 text-muted-foreground">
              Or register with email
            </span>
          </div>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setShowSuccessAlert(false);

            // Validate password length
            if (password.length < 8) {
              setError("Password must be at least 8 characters long");
              return;
            }

            await authClient.signUp.email(
              {
                email,
                password,
                name: "",
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              autoComplete="new-password"
              placeholder="Password"
              required
              className={showPasswordTooShort ? "border-destructive" : ""}
            />
            {showPasswordTooShort && (
              <p className="text-sm text-destructive">
                Password must be at least 8 characters long
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || password.length < 8 || googleLoading}
          >
            {loading ? <Spinner /> : "Create an account"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-1 -my-2">
        <Link href="/login" className={cn(buttonVariants({ variant: "link" }))}>
          Already have an account? Login
        </Link>
      </CardFooter>
    </>
  );
}
