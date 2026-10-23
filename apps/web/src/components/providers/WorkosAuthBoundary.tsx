"use client";

import { api } from "@teak/convex";
import { useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAction, useConvexAuth } from "convex/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Loading from "@/app/loading";
import { Button } from "@/components/ui/button";
import { ConvexQueryCacheProvider } from "@/lib/convexQueryCache";
import { useQuery } from "@/lib/convexQueryHooks";
import { signOut } from "@/lib/sign-out-client";
import { StatusScreen } from "../StatusScreen";
import { AuthUnavailable } from "./AuthUnavailable";
import { PostHogIdentify } from "./PostHogIdentify";

type Bootstrap =
  | { status: "ok"; teakUserId: string }
  | { status: "verify_email" | "frozen" }
  | { status: "quarantined"; reason: string };

// A new account's profile can reach Convex a moment after the browser does.
// The backend fetches it from WorkOS, so a short wait almost always clears it.
const PENDING_PROFILE_RETRY_MS = [1000, 2000, 3000];
const isPendingProfile = (result: Bootstrap) =>
  result.status === "quarantined" && result.reason === "profile_pending";

const blockedMessages = {
  verify_email: "Verify your email to open Teak.",
  frozen: "Signups are paused. Your account hasn't been created.",
  quarantined: "Your account isn't ready yet. Try again or contact support.",
};

// These screens show while the server may still hold the session the app
// rejected, so `renew` asks AuthKit for a fresh one instead of going straight
// back to the same page.
const signInHere = () =>
  window.location.replace(
    `/sign-in?renew=1&next=${encodeURIComponent(window.location.pathname + window.location.search)}`
  );
const signIn = () => window.location.replace("/sign-in?renew=1");

export function WorkosAuthBoundary({
  children,
  loading: loadingState = <Loading />,
}: {
  children: ReactNode;
  loading?: ReactNode;
}) {
  const { user, sessionId, loading } = useAuth();
  const { error: tokenError, refresh } = useAccessToken();
  const auth = useConvexAuth();
  const ensure = useAction(api.workosBootstrap.ensureUserNow);
  const identity = user ? `${user.id}:${sessionId ?? ""}` : null;
  const established = useRef(identity);
  if (established.current === null && identity) {
    established.current = identity;
  }
  const changed =
    established.current !== null &&
    identity !== null &&
    established.current !== identity;
  const signedIn = auth.isAuthenticated && identity !== null && !changed;
  const profile = useQuery(api.auth.getAuthUser, signedIn ? {} : "skip");
  const [owner, setOwner] = useState<{
    identity: string;
    teakUserId: string;
  } | null>(null);
  if (profile && identity && owner?.identity !== identity) {
    setOwner({ identity, teakUserId: profile._id });
  }
  const ownerId = owner?.identity === identity ? owner.teakUserId : null;
  const [bootstrap, setBootstrap] = useState<{
    identity: string;
    result: Bootstrap;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const needsBootstrap = signedIn && profile === null && ownerId === null;
  const blocked =
    bootstrap?.identity === identity && bootstrap.result.status !== "ok"
      ? bootstrap.result.status
      : null;
  const waiting =
    loading ||
    auth.isLoading ||
    (signedIn &&
      (profile === undefined || (needsBootstrap && blocked === null)));
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
  const runBootstrap = useCallback(
    (forIdentity: string, isCurrent: () => boolean, attempt = 0) => {
      void ensure({})
        .then((result) => {
          if (!isCurrent()) {
            return;
          }
          const delay = PENDING_PROFILE_RETRY_MS[attempt];
          if (isPendingProfile(result) && delay !== undefined) {
            window.setTimeout(() => {
              if (isCurrent()) {
                runBootstrap(forIdentity, isCurrent, attempt + 1);
              }
            }, delay);
            return;
          }
          setBootstrap({ identity: forIdentity, result });
          if (result.status === "ok") {
            setOwner({
              identity: forIdentity,
              teakUserId: result.teakUserId,
            });
          }
          setFailed(false);
        })
        .catch(() => {
          if (isCurrent()) {
            setFailed(true);
          }
        });
    },
    [ensure]
  );
  useEffect(() => {
    if (!(needsBootstrap && identity)) {
      return;
    }
    let cancelled = false;
    runBootstrap(identity, () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [needsBootstrap, identity, runBootstrap]);
  const retryBootstrap = () => {
    if (needsBootstrap && identity) {
      runBootstrap(identity, () => true);
    }
  };
  const authLost = failed || (tokenError && !auth.isAuthenticated);
  if (authLost) {
    return (
      <AuthUnavailable
        retry={() => {
          void refresh()
            .then(() => {
              setFailed(false);
              retryBootstrap();
            })
            .catch(() => undefined);
        }}
      />
    );
  }
  if (timedOut) {
    return <AuthUnavailable />;
  }
  if (loading || auth.isLoading || changed) {
    return loadingState;
  }
  if (!(user && auth.isAuthenticated)) {
    return (
      <AuthUnavailable
        action="Sign in"
        message="Please sign in again."
        retry={signInHere}
      />
    );
  }
  if (profile === undefined) {
    return loadingState;
  }
  if (ownerId !== null && profile?._id !== ownerId) {
    return (
      <AuthUnavailable
        action="Sign in"
        message="Your session changed. Please sign in again."
        retry={signIn}
      />
    );
  }
  if (profile) {
    return (
      <ConvexQueryCacheProvider key={profile._id}>
        <PostHogIdentify
          email={profile.email ?? undefined}
          teakUserId={profile._id}
        />
        {children}
      </ConvexQueryCacheProvider>
    );
  }
  if (blocked === null) {
    return loadingState;
  }
  return (
    <StatusScreen
      action="Try again"
      message={blockedMessages[blocked]}
      onAction={retryBootstrap}
      role="status"
    >
      <Button onClick={() => void signOut()} variant="ghost">
        Sign out
      </Button>
    </StatusScreen>
  );
}
