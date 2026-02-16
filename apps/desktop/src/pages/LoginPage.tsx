import { useState } from "react";
import { toast } from "sonner";
import { TeakLogo } from "@/components/TeakLogo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
    <section className="mx-auto flex min-h-screen w-full max-w-xs flex-col items-center justify-center gap-8 px-4">
      <TeakLogo />
      <Button
        className="w-full"
        disabled={!isOnline || isLaunchingBrowser}
        onClick={() => void handleLogin()}
        type="button"
      >
        {isLaunchingBrowser ? <Spinner /> : "Login"}
      </Button>
    </section>
  );
}
