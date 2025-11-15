"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
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

  const handleSubmit = async () => {
    if (!email) {
      setError("Email is required");
      return;
    }

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
        <Loading />
      </AuthLoading>
      <Unauthenticated>
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">Forgot password</CardTitle>
          <CardDescription>
            We'll email you a secure link to create a new password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
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
              <p className="text-sm text-destructive" role="status">
                {error}
              </p>
            )}
            {sent && (
              <p className="text-sm text-muted-foreground" role="status">
                If an account exists for{" "}
                <span className="font-medium">{email}</span>, a reset link is on
                its way.
              </p>
            )}
            <Button
              type="button"
              className="w-full"
              disabled={loading || !email}
              onClick={handleSubmit}
            >
              {loading ? (
                <Loader2 className="animate-spin" size={16} />
              ) : sent ? (
                "Resend link"
              ) : (
                "Send reset link"
              )}
            </Button>
          </div>
        </CardContent>
        <CardFooter className="text-center text-primary">
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
