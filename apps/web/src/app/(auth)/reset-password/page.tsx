"use client";

import { Button, buttonVariants } from "@teak/ui/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@teak/ui/components/ui/card";
import { Input } from "@teak/ui/components/ui/input";
import { Label } from "@teak/ui/components/ui/label";
import {
  AUTH_STICKY_TOAST_OPTIONS,
  MANUAL_CLOSE_TOAST_OPTIONS,
} from "@teak/ui/constants/toast";
import { cn } from "@teak/ui/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  const [success, setSuccess] = useState(false);

  const validationMessage = useMemo(() => {
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password && passwordConfirmation && password !== passwordConfirmation) {
      return "Passwords must match.";
    }
    return null;
  }, [password, passwordConfirmation]);

  const linkErrorMessage = useMemo(() => {
    if (errorCode) {
      return (
        errorMessages[errorCode] ??
        "We couldn't verify your reset link. Request a new one."
      );
    }

    if (!token) {
      return "We need a valid reset link to finish updating your password.";
    }

    return null;
  }, [errorCode, token]);

  useEffect(() => {
    if (!linkErrorMessage) {
      return;
    }

    toast.error(linkErrorMessage, MANUAL_CLOSE_TOAST_OPTIONS);
  }, [linkErrorMessage]);

  const canSubmit =
    Boolean(token) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === passwordConfirmation &&
    !loading;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      toast.error(
        "This link is missing its token. Request a new reset email.",
        MANUAL_CLOSE_TOAST_OPTIONS
      );
      return;
    }

    if (!canSubmit) {
      return;
    }

    setLoading(true);

    const { error: resetError } = await authClient.resetPassword({
      token,
      newPassword: password,
    });

    setLoading(false);

    if (resetError) {
      toast.error(
        resetError.message ??
          "We couldn't update your password. Request a new link and try again.",
        MANUAL_CLOSE_TOAST_OPTIONS
      );
      return;
    }

    setSuccess(true);
    posthog.capture("password_reset_completed");
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

            {validationMessage && (
              <p className="text-destructive text-sm">{validationMessage}</p>
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
