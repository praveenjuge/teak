"use client";

import { api } from "@teak/convex";
import { Button } from "@teak/ui/components/ui/button";
import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { useQuery } from "@teak/ui/convex-query-hooks";
import { useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { useConvexAuth, useMutation } from "convex/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Loading from "@/app/loading";
import { signOut } from "@/lib/sign-out-client";
import { AuthUnavailable } from "./AuthUnavailable";

type Bootstrap =
  | { status: "ok"; teakUserId: string }
  | { status: "verify_email" | "frozen" }
  | { status: "quarantined"; reason: string };

export function WorkosAuthBoundary({ children }: { children: ReactNode }) {
  const { user, sessionId, loading } = useAuth();
  const { error: tokenError, refresh } = useAccessToken();
  const auth = useConvexAuth();
  const ensure = useMutation(api.workosBootstrap.ensureUser);
  const identity = user ? `${user.id}:${sessionId ?? ""}` : null;
  const established = useRef(identity);
  if (established.current === null && identity) {
    established.current = identity;
  }
  const changed =
    established.current !== null &&
    identity !== null &&
    established.current !== identity;
  const [bootstrap, setBootstrap] = useState<{
    identity: string;
    result: Bootstrap;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const waiting =
    loading ||
    auth.isLoading ||
    (auth.isAuthenticated && (!bootstrap || bootstrap.identity !== identity));
  useEffect(() => {
    if (!waiting) {
      setTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, [waiting]);
  useEffect(() => {
    if (changed) {
      window.location.reload();
    }
  }, [changed]);
  // Retrying repeats the mutation even when the authenticated identity is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit retry trigger.
  useEffect(() => {
    if (!(auth.isAuthenticated && identity) || changed) {
      return;
    }
    let cancelled = false;
    void ensure({})
      .then((result) => {
        if (!cancelled) {
          setBootstrap({ identity, result });
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated, identity, changed, ensure, attempt]);
  if (tokenError || failed) {
    return (
      <AuthUnavailable
        retry={() => {
          void refresh()
            .then(() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            })
            .catch(() => setFailed(true));
        }}
      />
    );
  }
  if (timedOut) {
    return <AuthUnavailable />;
  }
  if (loading || auth.isLoading || changed) {
    return <Loading />;
  }
  if (!(user && auth.isAuthenticated)) {
    return (
      <AuthUnavailable
        message="Please sign in again."
        retry={() =>
          window.location.replace(
            `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
          )
        }
      />
    );
  }
  if (!bootstrap || bootstrap.identity !== identity) {
    return <Loading />;
  }
  if (bootstrap.result.status !== "ok") {
    const message = {
      verify_email: "Verify your email to open Teak.",
      frozen: "Signups are paused. Your account hasn't been created.",
      quarantined:
        "Your account isn't ready yet. Try again or contact support.",
    }[bootstrap.result.status];
    return (
      <div
        className="mx-auto grid max-w-sm gap-4 p-6 text-center"
        role="status"
      >
        <p>{message}</p>
        <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        <Button onClick={() => void signOut()} variant="ghost">
          Sign out
        </Button>
      </div>
    );
  }
  return (
    <WorkosVault teakUserId={bootstrap.result.teakUserId}>
      {children}
    </WorkosVault>
  );
}

function WorkosVault({
  children,
  teakUserId,
}: {
  children: ReactNode;
  teakUserId: string;
}) {
  const profile = useQuery(api.auth.getAuthUser, {});
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (profile !== undefined) {
      setTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, [profile]);
  if (profile === undefined) {
    return timedOut ? <AuthUnavailable /> : <Loading />;
  }
  if (!profile || profile._id !== teakUserId) {
    return (
      <AuthUnavailable
        message="Your session changed. Please sign in again."
        retry={() => window.location.replace("/login")}
      />
    );
  }
  return (
    <ConvexQueryCacheProvider key={teakUserId}>
      {children}
    </ConvexQueryCacheProvider>
  );
}
