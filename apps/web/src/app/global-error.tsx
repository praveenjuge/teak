"use client";

import * as Sentry from "@sentry/nextjs";
import { buttonVariants } from "@teak/ui/components/ui/button";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    // global-error must include html and body tags
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h2>Something went wrong! {error.message}</h2>
        <button
          className={cn(buttonVariants())}
          onClick={() => reset()}
          type="button"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
