"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import {
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { metrics } from "@/lib/metrics";

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
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="me@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                If the email address is registered, a password reset link will
                be sent.
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
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
      <CardFooter className="flex-col gap-1 -my-2">
        <Link href="/login" className={cn(buttonVariants({ variant: "link" }))}>
          Back to Login
        </Link>
      </CardFooter>
    </>
  );
}
