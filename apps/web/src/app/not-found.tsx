import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

// Unmatched URLs render here inside the root layout, so the page follows the
// theme the person picked, not only the system one.
export default function NotFound() {
  return (
    <main className="fixed inset-0 grid place-items-center p-6">
      <div className="flex max-w-xs flex-col items-center gap-6 text-center">
        <Wordmark className="h-6 w-auto text-foreground" variant="current" />
        <div className="space-y-2">
          <h1 className="font-semibold text-foreground text-lg">
            Page not found
          </h1>
          <p className="text-balance text-base text-muted-foreground">
            This page doesn’t exist or has moved.
          </p>
        </div>
        <Link
          className={buttonVariants({ className: "min-w-32", size: "lg" })}
          href="/"
        >
          Go to your cards
        </Link>
      </div>
    </main>
  );
}
