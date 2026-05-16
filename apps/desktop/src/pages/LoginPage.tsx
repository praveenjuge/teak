import { Button } from "@teak/ui/components/ui/button";
import { Spinner } from "@teak/ui/components/ui/spinner";
import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  startNativeAuthPolling,
  startNativeAuthRequest,
} from "@/lib/native-auth";

interface LoginPageProps {
  isOnline: boolean;
}

export function LoginPage({ isOnline }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAuth = useCallback(async () => {
    if (!isOnline || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = await startNativeAuthRequest();
      await window.teakDesktop.shell.openExternal(url);
      setIsWaitingForAuth(true);

      startNativeAuthPolling().then((result) => {
        if (result === "authenticated") {
          setIsWaitingForAuth(false);
        } else if (result === "timeout") {
          toast.error("Login timed out. Please try again.");
          setIsWaitingForAuth(false);
          setError("Login timed out.");
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
      setIsWaitingForAuth(false);
    } finally {
      setIsLoading(false);
    }
  }, [isOnline, isLoading]);

  return (
    <AuthScreenShell logo={<Logo variant="primary" />}>
      <div className="px-6">
        {!isOnline ? (
          <p className="text-center text-sm text-muted-foreground">
            You are offline. Please reconnect to sign in.
          </p>
        ) : isWaitingForAuth ? (
          <div className="flex flex-col items-center gap-4">
            <Spinner />
            <p className="text-center text-sm text-muted-foreground">
              Waiting for login in your browser...
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-sm text-muted-foreground">
              {error}
            </p>
            <Button
              className="w-full"
              onClick={() => void startAuth()}
              type="button"
            >
              Try Again
            </Button>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={isLoading}
            onClick={() => void startAuth()}
            type="button"
          >
            Sign In
          </Button>
        )}
      </div>
    </AuthScreenShell>
  );
}
