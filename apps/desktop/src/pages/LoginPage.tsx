import { Button } from "@teak/ui/components/ui/button";
import { Spinner } from "@teak/ui/components/ui/spinner";
import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  startDesktopAuthPolling,
  startDesktopAuthRequest,
} from "@/lib/desktop-auth";
import { buildWebUrl } from "@/lib/desktop-config";

const AUTH_COMPLETE_URL = buildWebUrl("/desktop/auth/complete");

interface LoginPageProps {
  isOnline: boolean;
}

export function LoginPage({ isOnline }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const webviewRef = useRef<HTMLWebViewElement | null>(null);
  const hasStartedRef = useRef(false);

  const startAuth = useCallback(async () => {
    if (!isOnline || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = await startDesktopAuthRequest();
      setAuthUrl(url);
      startDesktopAuthPolling().then((result) => {
        if (result === "authenticated") {
          // Hide the webview immediately so the user sees a loading
          // state while Convex auth finalizes, instead of the stale
          // "you may close this window" page.
          setAuthUrl(null);
        } else if (result === "timeout") {
          toast.error("Login timed out. Please try again.");
          setAuthUrl(null);
          setError("Login timed out.");
          hasStartedRef.current = false;
        }
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Unable to start login";
      toast.error(message);
      setError(message);
      setAuthUrl(null);
      hasStartedRef.current = false;
    } finally {
      setIsLoading(false);
    }
  }, [isOnline, isLoading]);

  // Auto-start the auth flow when online
  useEffect(() => {
    if (isOnline && !hasStartedRef.current && !authUrl && !isLoading) {
      hasStartedRef.current = true;
      void startAuth();
    }
  }, [isOnline, authUrl, isLoading, startAuth]);

  // Hide the webview as soon as it navigates to the auth-complete page,
  // so the user never sees the "you may close this window" message.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !authUrl) {
      return;
    }

    const handleNavigate = (event: Event) => {
      const navEvent = event as Event & { url?: string };
      if (navEvent.url?.startsWith(AUTH_COMPLETE_URL)) {
        setAuthUrl(null);
      }
    };

    webview.addEventListener("did-navigate", handleNavigate);
    return () => {
      webview.removeEventListener("did-navigate", handleNavigate);
    };
  }, [authUrl]);

  // Show the webview directly when we have the auth URL
  if (authUrl) {
    return (
      <div className="flex h-screen w-full flex-col">
        <webview
          ref={webviewRef}
          className="flex-1"
          partition={`auth-${Date.now()}`}
          src={authUrl}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    );
  }

  // Loading / offline / error fallback
  return (
    <AuthScreenShell logo={<Logo variant="primary" />}>
      <div className="px-6">
        {!isOnline ? (
          <p className="text-center text-sm text-muted-foreground">
            You are offline. Please reconnect to sign in.
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-sm text-muted-foreground">
              {error}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                hasStartedRef.current = true;
                void startAuth();
              }}
              type="button"
            >
              Try Again
            </Button>
          </div>
        ) : (
          <div className="flex justify-center">
            <Spinner />
          </div>
        )}
      </div>
    </AuthScreenShell>
  );
}
