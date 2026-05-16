import { Loader2 } from "lucide-react";
import { AppleIcon, GoogleIcon } from "../../icons";
import { Button } from "../ui/button";

interface SocialAuthButtonsProps {
  appleLoading: boolean;
  disabled?: boolean;
  googleLoading: boolean;
  onAppleSignIn: () => void;
  onGoogleSignIn: () => void;
}

export function SocialAuthButtons({
  appleLoading,
  disabled,
  googleLoading,
  onAppleSignIn,
  onGoogleSignIn,
}: SocialAuthButtonsProps) {
  return (
    <div className="grid gap-2">
      <Button
        className="w-full"
        disabled={disabled}
        onClick={onGoogleSignIn}
        type="button"
        variant="outline"
      >
        {googleLoading ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <>
            <GoogleIcon className="h-4 w-4" />
            Continue with Google
          </>
        )}
      </Button>

      <Button
        className="w-full"
        disabled={disabled}
        onClick={onAppleSignIn}
        type="button"
        variant="outline"
      >
        {appleLoading ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <>
            <AppleIcon className="h-4 w-4" />
            Continue with Apple
          </>
        )}
      </Button>
    </div>
  );
}
