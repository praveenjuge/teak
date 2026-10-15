"use client";

import { captureClientException } from "@teak/convex/shared/client-telemetry";
import { Button } from "@teak/ui/components/ui/button";
import type { ReactNode } from "react";
import { RetryableQueryBoundary } from "../feedback/RetryableQueryBoundary";

interface CardsReadBoundaryProps {
  children: (retryKey: string | undefined) => ReactNode;
  contentContainerClassName?: string;
  headerLeading?: ReactNode;
  /** The view being read; a new view clears the failure. */
  resetKey: string;
}

/**
 * Whether an error is the card grid's own read failing. The Convex client
 * prefixes a query's errors with its name, such as
 * `[CONVEX Q(cards:searchCardsPaginated)] ... Server Error`.
 */
export const isCardsReadError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("[CONVEX Q(cards:searchCardsPaginated)]");

/**
 * Keeps a failed card list read (a Convex query error thrown while the grid
 * renders) inside the library instead of replacing the whole app. Only the
 * card read gets a retry; any other error (another query, a render bug) goes
 * on to the app's own error screen.
 */
export function CardsReadBoundary({
  children,
  contentContainerClassName,
  headerLeading,
  resetKey,
}: CardsReadBoundaryProps) {
  return (
    <RetryableQueryBoundary
      catches={isCardsReadError}
      fallback={(retry) => {
        const content = (
          <>
            {headerLeading ? (
              <div className="flex h-12 items-center">{headerLeading}</div>
            ) : null}
            <div className="space-y-4 py-12 text-center" role="alert">
              <p className="text-muted-foreground">Couldn't load your cards.</p>
              <Button onClick={retry} variant="outline">
                Try again
              </Button>
            </div>
          </>
        );
        return contentContainerClassName ? (
          <main className={contentContainerClassName}>{content}</main>
        ) : (
          content
        );
      }}
      onCatch={(error) =>
        captureClientException(error, { "ui.boundary": "cards" })
      }
      resetKey={resetKey}
    >
      {children}
    </RetryableQueryBoundary>
  );
}
