import { Button } from "@teak/ui/components/ui/button";
import { Spinner } from "@teak/ui/components/ui/spinner";
import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import { useState } from "react";
import { toast } from "sonner";
import { openAuthWindow } from "@/lib/auth-window";
import {
  startDesktopAuthPolling,
  startDesktopAuthRequest,
} from "@/lib/desktop-auth";

interface LoginPageProps {
  isOnline: boolean;
}

export function LoginPage({ isOnline }: LoginPageProps) {
  const [isLaunchingBrowser, setIsLaunchingBrowser] = useState(false);

  const handleLogin = async () => {
    if (!isOnline) {
      toast.error("You are offline. Please reconnect to login.");
      return;
    }

    setIsLaunchingBrowser(true);

    try {
      const authUrl = await startDesktopAuthRequest();
      await openAuthWindow(authUrl);
      startDesktopAuthPolling().then((result) => {
        if (result === "timeout") {
          toast.error("Login timed out. Please try again.");
        }
      });
      toast.message("Login window opened. Complete login to continue.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unable to start login";
      toast.error(message);
    } finally {
      setIsLaunchingBrowser(false);
    }
  };

  return (
    <AuthScreenShell logo={<Logo variant="primary" />}>
      <div className="px-6">
        <Button
          className="w-full"
          disabled={!isOnline || isLaunchingBrowser}
          onClick={() => void handleLogin()}
          type="button"
        >
          {isLaunchingBrowser ? <Spinner /> : "Login"}
        </Button>
      </div>
    </AuthScreenShell>
  );
}
