"use client";

import { Button } from "@teak/ui/components/ui/button";
import { CardContent, CardTitle } from "@teak/ui/components/ui/card";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AuthCardLoading } from "@/app/(auth)/AuthCardLoading";
import { startWorkosAuth } from "@/app/(auth)/actions";
import { getSafeNextPath } from "@/lib/safe-next-path";
import { useAuthMode } from "./AuthModeProvider";

type Flow = "signin" | "signup" | "recovery";

export function AuthPageMode({
  children,
  flow,
}: {
  children: ReactNode;
  flow: Flow;
}) {
  const mode = useAuthMode();
  if (!mode) {
    return <AuthCardLoading />;
  }
  if (flow === "recovery" && mode.accountChangesPaused) {
    return (
      <CardContent>
        <p role="status">Account changes are paused. Please try again later.</p>
        <Link href="/login">Back to sign in</Link>
      </CardContent>
    );
  }
  if (mode.primary === "betterauth") {
    return children;
  }
  if (flow === "signup" && mode.signupsDisabled) {
    return (
      <CardContent>
        <p role="status">Signups are paused. You can still sign in.</p>
        <Link href="/login">Sign in</Link>
      </CardContent>
    );
  }
  return <WorkosEntry flow={flow} />;
}

function WorkosEntry({ flow }: { flow: Flow }) {
  const params = useSearchParams();
  const next = params.get("next");
  const safeNext = getSafeNextPath(next);
  const alternatePath = flow === "signup" ? "/login" : "/register";
  const alternateHref =
    safeNext && safeNext !== "/"
      ? `${alternatePath}?next=${encodeURIComponent(safeNext)}`
      : alternatePath;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "Sign-in changed. Please start again." : null
  );
  const start = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const result = await startWorkosAuth(
        next,
        flow === "signup",
        flow === "recovery"
      );
      if (!result.url) {
        setError(
          result.error ?? "We couldn't start sign-in. Please try again."
        );
        setPending(false);
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError("We couldn't start sign-in. Please try again.");
      setPending(false);
    }
  }, [flow, next]);
  useEffect(() => {
    if (flow === "recovery") {
      void start();
    }
  }, [flow, start]);
  const title = {
    signup: "Create your Teak account",
    recovery: "Reset your password",
    signin: "Login to Teak",
  }[flow];
  const buttonLabel = error ? "Try again" : "Continue";
  return (
    <>
      <CardTitle className="text-center text-lg">{title}</CardTitle>
      <CardContent className="grid gap-4">
        <p className="text-muted-foreground text-sm">
          {flow === "recovery"
            ? "Continue to secure sign-in, then choose Forgot password."
            : "Continue to secure sign-in with your email, Google, or Apple."}
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={pending} onClick={() => void start()}>
          {pending ? "Opening sign-in…" : buttonLabel}
        </Button>
        <Link className="text-center text-sm" href={alternateHref}>
          {flow === "signup"
            ? "Already have an account? Sign in"
            : "New user? Register"}
        </Link>
      </CardContent>
    </>
  );
}
