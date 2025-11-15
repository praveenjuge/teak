"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";
import { AuthLoading, Unauthenticated } from "convex/react";
import Loading from "@/app/loading";

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
          setSent(true);
        },
      },
    });
  };

  return (
    <>
      <AuthLoading>
        <Loading fullscreen={false} />
      </AuthLoading>
      <Unauthenticated>
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">Forgot password</CardTitle>
          <CardDescription>
            We'll email you a secure link to create a new password
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
                  If an account exists for {email}, a reset link is on its way.
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
        <CardFooter className="text-center text-primary justify-center">
          <Link
            //@ts-ignore
            href="/login"
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Unauthenticated>
    </>
  );
}
