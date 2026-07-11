import {
  captureClientException,
  runClientSpan,
} from "@teak/convex/shared/client-telemetry";
import { counter, trackAuth } from "@teak/convex/shared/metrics";
import { TELEMETRY_METRICS } from "@teak/convex/shared/telemetry";
import { BrowserAuthPanel } from "@teak/ui/auth";
import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  cancelDesktopOAuth,
  completeDesktopOAuth,
  startDesktopOAuthRequest,
} from "@/lib/native-auth";

interface LoginPageProps {
  isOnline: boolean;
}

// Give up on an in-flight browser login after 10 minutes and reset the UI.
const DESKTOP_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function getStartAuthErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return typeof err === "string" ? err : "Unable to start login";
}

export function LoginPage({ isOnline }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuthTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Listen for the loopback OAuth callback for the lifetime of the page. When
  // the browser redirects back, finish the token/session exchange.
  useEffect(() => {
    const unsubscribe = window.teakDesktop.oauth.onCallback(
      ({ code, state }) => {
        void (async () => {
          clearAuthTimeout();
          const result = await runClientSpan(
            {
              name: "desktop.oauth.callback",
              operation: "auth",
              stage: "sign_in",
            },
            () => completeDesktopOAuth(code, state)
          );
          if (result === "authenticated") {
            trackAuth({ outcome: "success", stage: "sign_in" });
            counter(TELEMETRY_METRICS.desktopOauth, 1, {
              outcome: "success",
              stage: "callback",
            });
            setIsWaitingForAuth(false);
            setError(null);
            return;
          }

          setIsWaitingForAuth(false);
          trackAuth({ outcome: "failure", stage: "sign_in" });
          counter(TELEMETRY_METRICS.desktopOauth, 1, {
            outcome: "failure",
            stage: result,
          });
          if (result === "timeout") {
            toast.error("Login timed out. Please try again.");
            setError("Login timed out.");
          } else {
            toast.error("Login could not be completed. Please try again.");
            setError("Login could not be completed.");
          }
        })();
      }
    );

    return () => {
      clearAuthTimeout();
      unsubscribe();
    };
  }, [clearAuthTimeout]);

  const startAuth = useCallback(async () => {
    if (!isOnline || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);
    trackAuth({ outcome: "attempt", stage: "sign_in" });
    counter(TELEMETRY_METRICS.desktopOauth, 1, {
      outcome: "attempt",
      stage: "start",
    });

    try {
      const url = await runClientSpan(
        {
          name: "desktop.oauth.start",
          operation: "auth",
          stage: "sign_in",
        },
        startDesktopOAuthRequest
      );
      await window.teakDesktop.shell.openExternal(url);
      setIsWaitingForAuth(true);

      clearAuthTimeout();
      timeoutRef.current = setTimeout(() => {
        trackAuth({ outcome: "failure", stage: "sign_in" });
        counter(TELEMETRY_METRICS.desktopOauth, 1, {
          outcome: "failure",
          stage: "timeout",
        });
        setIsWaitingForAuth(false);
        setError("Login timed out.");
        toast.error("Login timed out. Please try again.");
        void cancelDesktopOAuth().catch(() => undefined);
      }, DESKTOP_AUTH_TIMEOUT_MS);
    } catch (err) {
      trackAuth({ outcome: "failure", stage: "sign_in" });
      counter(TELEMETRY_METRICS.desktopOauth, 1, {
        outcome: "failure",
        stage: "start",
      });
      captureClientException(err, { operation: "desktop.oauth.start" });
      const message = getStartAuthErrorMessage(err);
      toast.error(message);
      setError(message);
      setIsWaitingForAuth(false);
      await cancelDesktopOAuth().catch(() => undefined);
    } finally {
      setIsLoading(false);
    }
  }, [isOnline, isLoading, clearAuthTimeout]);

  return (
    <AuthScreenShell logo={<Logo variant="primary" />}>
      <div className="px-6">
        <BrowserAuthPanel
          error={error}
          isLoading={isLoading}
          isOnline={isOnline}
          isWaitingForAuth={isWaitingForAuth}
          onStartAuth={() => void startAuth()}
        />
      </div>
    </AuthScreenShell>
  );
}
