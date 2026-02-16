import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { openAuthWindow } from "@/lib/auth-window";
import {
  startDesktopAuthPolling,
  startDesktopAuthRequest,
} from "@/lib/desktop-auth";

interface LoginFormProps {
  isOnline: boolean;
}

export function LoginForm({ isOnline }: LoginFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLaunchingBrowser, setIsLaunchingBrowser] = useState(false);

  const requireOnline = () => {
    if (isOnline) {
      return true;
    }

    setError("You are offline. Please reconnect to login.");
    toast.error("You are offline. Please reconnect to login.");
    return false;
  };

  const startPollingWithFeedback = () => {
    void startDesktopAuthPolling().then((result) => {
      if (result === "timeout") {
        const message = "Login timed out. Please try again.";
        setError(message);
        toast.error(message);
      }
    });
  };

  const handleLoginInAppBrowser = async () => {
    if (!requireOnline()) {
      return;
    }

    setError(null);
    setIsLaunchingBrowser(true);

    try {
      const authUrl = await startDesktopAuthRequest();
      await openAuthWindow(authUrl);
      startPollingWithFeedback();
      toast.message("Login window opened. Complete login to continue.");
    } catch (signInError) {
      const message =
        signInError instanceof Error
          ? signInError.message
          : typeof signInError === "string"
            ? signInError
            : "Unable to start in-app login";
      setError(message);
      toast.error(message);
    } finally {
      setIsLaunchingBrowser(false);
    }
  };

  return (
    <>
      <CardTitle className="text-center text-lg">Login to Teak</CardTitle>
      <CardContent>
        {error && (
          <Alert className="mb-4" variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <p className="mb-4 text-center text-muted-foreground text-sm">
          Continue in Teak&apos;s login window.
        </p>

        <div className="grid">
          <Button
            className="w-full"
            disabled={!isOnline || isLaunchingBrowser}
            onClick={() => void handleLoginInAppBrowser()}
            type="button"
          >
            {isLaunchingBrowser ? <Spinner /> : "Login in App Browser"}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="-my-2 justify-center">
        <p className="text-muted-foreground text-xs">
          Sign up and password reset are handled on the web.
        </p>
      </CardFooter>
    </>
  );
}
