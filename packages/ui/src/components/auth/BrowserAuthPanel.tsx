import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

interface BrowserAuthPanelProps {
  error: string | null;
  isLoading: boolean;
  isOnline: boolean;
  isWaitingForAuth: boolean;
  onStartAuth: () => void;
}

export function BrowserAuthPanel({
  error,
  isLoading,
  isOnline,
  isWaitingForAuth,
  onStartAuth,
}: BrowserAuthPanelProps) {
  if (!isOnline) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        You are offline. Please reconnect to sign in.
      </p>
    );
  }

  if (isWaitingForAuth) {
    return (
      <div className="flex flex-col items-center gap-4">
        <Spinner />
        <p className="text-center text-sm text-muted-foreground">
          Waiting for login in your browser...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-center text-sm text-muted-foreground">{error}</p>
        <Button className="w-full" onClick={onStartAuth} type="button">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <Button
      className="w-full"
      disabled={isLoading}
      onClick={onStartAuth}
      type="button"
    >
      Sign In
    </Button>
  );
}
