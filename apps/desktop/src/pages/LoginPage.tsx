import { BrowserAuthPanel } from "@teak/ui/auth";
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
      const message = getStartAuthErrorMessage(err);
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
