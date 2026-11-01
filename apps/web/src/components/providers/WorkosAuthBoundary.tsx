"use client";

import { api } from "@teak/convex";
import { useTranslations } from "@teak/i18n/react";
import { useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { useConvexAuth, useMutation } from "convex/react";
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

const BLOCKED_MESSAGE_KEYS = {
  verify_email: "verifyEmail",
  frozen: "frozen",
  quarantined: "quarantined",
} as const;

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
  const t = useTranslations("providers.auth");
  const tc = useTranslations("common");
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
  const signedIn = auth.isAuthenticated && identity !== null && !changed;
  // While Convex checks the session, the profile the server fetched for this
  // page (its seed) opens the app at once; the client holds the live query
  // until the session is accepted.
  const awaitingConvex =
    auth.isLoading && !loading && identity !== null && !changed;
  const profile = useQuery(
    api.auth.getAuthUser,
    signedIn || awaitingConvex ? {} : "skip"
  );
  const openEarly = awaitingConvex && Boolean(profile);
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
    (forIdentity: string, isCurrent: () => boolean) => {
      void ensure({})
        .then((result) => {
          if (!isCurrent()) {
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
  if (loading || (auth.isLoading && !openEarly) || changed) {
    return loadingState;
  }
  if (!(openEarly || (user && auth.isAuthenticated))) {
    return (
      <AuthUnavailable
        action={t("signIn")}
        message={t("signInAgain")}
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
        action={t("signIn")}
        message={t("sessionChanged")}
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
      action={tc("tryAgain")}
      message={t(`blocked.${BLOCKED_MESSAGE_KEYS[blocked]}`)}
      onAction={retryBootstrap}
      role="status"
    >
      <Button onClick={() => void signOut()} variant="ghost">
        {t("signOut")}
      </Button>
    </StatusScreen>
  );
}
