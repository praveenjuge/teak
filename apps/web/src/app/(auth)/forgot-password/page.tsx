"use client";

import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
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

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") {
      return "/reset-password";
    }

    return `${window.location.origin}/reset-password`;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    await authClient.requestPasswordReset({
      email,
      redirectTo,
      fetchOptions: {
        onRequest: () => {
          setLoading(true);
          setError(null);
          setSent(false);
        },
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          setError(ctx.error?.message ?? "We couldn't send the reset email.");
        },
        onSuccess: () => {
          metrics.passwordResetRequested();
          setSent(true);
          toast.success("Reset link sent (if account exists).", {
            ...AUTH_STICKY_TOAST_OPTIONS,
          });
        },
      },
    });
  };

  return (
    <>
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Forgot password</CardTitle>
        <CardDescription>
          We&apos;ll email you a secure link to create a new password
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              autoComplete="email"
              id="email"
              inputMode="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="me@example.com"
              required
              type="email"
              value={email}
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {sent && (
            <Alert>
              <CheckCircle />
              <AlertDescription>
                If the email address is registered, a password reset link will
                be sent.
              </AlertDescription>
            </Alert>
          )}
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : sent ? (
              "Resend link"
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="-my-2 flex-col gap-1">
        <Link className={cn(buttonVariants({ variant: "link" }))} href="/login">
          Back to Login
        </Link>
      </CardFooter>
    </>
  );
}
