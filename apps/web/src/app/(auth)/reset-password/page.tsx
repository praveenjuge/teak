"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { authClient } from "@/lib/auth-client";
import { metrics } from "@/lib/metrics";
import { AUTH_STICKY_TOAST_OPTIONS } from "@/lib/toastConfig";
import { cn } from "@/lib/utils";

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
          "We couldn't verify your reset link. Request a new one."
      );
    }
  }, [errorCode]);

  const helperText = useMemo(() => {
    if (error) {
      return { text: error, variant: "error" as const };
    }
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

    if (!canSubmit) {
      return;
    }

    setLoading(true);
    setError(null);

    const { error: resetError } = await authClient.resetPassword({
      token,
      newPassword: password,
    });

    setLoading(false);

    if (resetError) {
      metrics.passwordResetCompleted(false);
      setError(
        resetError.message ??
          "We couldn't update your password. Request a new link and try again."
      );
      return;
    }

    metrics.passwordResetCompleted(true);
    setSuccess(true);
    toast.success("Password updated.", {
      ...AUTH_STICKY_TOAST_OPTIONS,
    });
  };

  return (
    <>
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Reset password</CardTitle>
        <CardDescription>
          Choose a new password to secure your account
        </CardDescription>
      </CardHeader>

      <CardContent>
        {success ? (
          <div className="grid gap-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <p className="text-muted-foreground text-sm">
              Your password has been updated. Login with your new credentials to
              continue.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Go to Login</Link>
            </Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={handleReset}>
            <div className="grid gap-2">
              <Label htmlFor="password">New password</Label>
              <Input
                autoComplete="new-password"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Create a new password"
                required
                type="password"
                value={password}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password_confirmation">Confirm password</Label>
              <Input
                autoComplete="new-password"
                id="password_confirmation"
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
                placeholder="Re-enter your password"
                required
                type="password"
                value={passwordConfirmation}
              />
            </div>

            {helperText && (
              <Alert
                variant={
                  helperText.variant === "error" ? "destructive" : "default"
                }
              >
                {helperText.variant === "error" && <AlertCircle />}
                <AlertDescription>{helperText.text}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" disabled={!canSubmit} type="submit">
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        )}
      </CardContent>

      {!success && (
        <CardFooter className="-my-2 flex-col gap-1">
          <Link
            className={cn(buttonVariants({ variant: "link" }))}
            href="/forgot-password"
          >
            Need a new link? Request Again
          </Link>
        </CardFooter>
      )}
    </>
  );
}
