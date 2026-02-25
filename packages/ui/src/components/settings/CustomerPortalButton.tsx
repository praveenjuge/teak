import { type ReactNode, useState } from "react";
import { cn } from "../../lib/utils";
import { buttonVariants } from "../ui/button";
import { Spinner } from "../ui/spinner";

interface CustomerPortalButtonProps {
  children: ReactNode;
  className?: string;
  onCreatePortal: () => Promise<void>;
}

export async function triggerCustomerPortal(
  onCreatePortal: () => Promise<void>
) {
  await onCreatePortal();
}

export function CustomerPortalButton({
  className,
  children,
  onCreatePortal,
}: CustomerPortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handlePortal = async () => {
    setIsLoading(true);
    try {
      await triggerCustomerPortal(onCreatePortal);
    } catch {
      // Caller owns error handling/toasts.
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      className={cn(
        buttonVariants({
          variant: "link",
          size: "sm",
        }),
        className
      )}
      disabled={isLoading}
      onClick={handlePortal}
      type="button"
    >
      {isLoading ? <Spinner /> : children}
    </button>
  );
}
