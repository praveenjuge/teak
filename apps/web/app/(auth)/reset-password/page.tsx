"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthLoading, Unauthenticated } from "convex/react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Loading from "@/app/loading";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD_LENGTH = 8;

const errorMessages: Record<string, string> = {
  INVALID_TOKEN:
    "This reset link is invalid or has expired. Request a new one.",
  EXPIRED_TOKEN: "This reset link has expired. Request a new one.",
};

export default function ResetPassword() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const errorCode = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (errorCode) {
      setError(
        errorMessages[errorCode] ??
          "We couldn't verify your reset link. Request a new one.",
      );
    }
  }, [errorCode]);

  const helperText = useMemo(() => {
    if (error) return { text: error, variant: "error" as const };
    if (!token) {
      return {
        text: "We need a valid reset link to finish updating your password.",
        variant: "error" as const,
      };
    }
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      return {
        text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        variant: "error" as const,
      };
    }
    if (password && passwordConfirmation && password !== passwordConfirmation) {
      return {
        text: "Passwords must match.",
        variant: "error" as const,
      };
    }
    return null;
  }, [error, password, passwordConfirmation, token]);

  const canSubmit =
    Boolean(token) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === passwordConfirmation &&
    !loading;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError("This link is missing its token. Request a new reset email.");
      return;
    }

    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    const { error: resetError } = await authClient.resetPassword({
      token,
      newPassword: password,
    });

    setLoading(false);

    if (resetError) {
      setError(
        resetError.message ??
          "We couldn't update your password. Request a new link and try again.",
      );
      return;
    }

    setSuccess(true);
  };

  return (
    <>
      <AuthLoading>
        <Loading fullscreen={false} />
      </AuthLoading>

      <Unauthenticated>
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">Reset password</CardTitle>
          <CardDescription>
            Choose a new password to secure your account
          </CardDescription>
        </CardHeader>

        <CardContent>
          {success ? (
            <div className="grid gap-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
              <p className="text-sm text-muted-foreground">
                Your password has been updated. Sign in with your new
                credentials to continue.
              </p>
              <Button asChild className="w-full">
                <Link
                  //@ts-ignore
                  href="/login"
                >
                  Go to sign in
                </Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Create a new password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password_confirmation">Confirm password</Label>
                <Input
                  id="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  required
                  value={passwordConfirmation}
                  onChange={(event) =>
                    setPasswordConfirmation(event.target.value)
                  }
                />
              </div>

              {helperText && (
                <Alert
                  variant={
                    helperText.variant === "error" ? "destructive" : "default"
                  }
                >
                  {helperText.variant === "error" && (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>{helperText.text}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Update password"
                )}
              </Button>
            </form>
          )}
        </CardContent>

        {!success && (
          <CardFooter className="text-center text-primary">
            <Link
              //@ts-ignore
              href="/forgot-password"
            >
              Need a new link? Request password reset
            </Link>
          </CardFooter>
        )}
      </Unauthenticated>
    </>
  );
}
