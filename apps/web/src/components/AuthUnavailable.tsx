"use client";

import { Button } from "@teak/ui/components/ui/button";

export function AuthUnavailable({
  message = "We couldn't check your session. Please try again.",
  retry = () => window.location.reload(),
}: {
  message?: string;
  retry?: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-sm gap-4 p-6 text-center" role="alert">
      <p>{message}</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
