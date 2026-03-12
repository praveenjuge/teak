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
import { AUTH_STICKY_TOAST_OPTIONS } from "@teak/ui/constants/toast";
import { cn } from "@teak/ui/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

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
          setSent(false);
        },
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(
            ctx.error?.message ?? "We couldn't send the reset email."
          );
        },
        onSuccess: () => {
          setSent(true);
          posthog.capture("password_reset_requested");
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
