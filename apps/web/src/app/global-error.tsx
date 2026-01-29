"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

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
    <html>
      <body className="flex justify-center items-center flex-col min-h-screen gap-4">
        <h2>Something went wrong! {error.message}</h2>
        <button onClick={() => reset()} className={cn(buttonVariants())}>
          Try again
        </button>
      </body>
    </html>
  );
}
