"use client";

import { captureClientException } from "@teak/convex/shared/client-telemetry";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { RetryableQueryBoundary } from "../components/feedback/RetryableQueryBoundary";

interface CardsReadBoundaryProps {
  children: (retryKey: string | undefined) => ReactNode;
  contentContainerClassName?: string;
  headerLeading?: ReactNode;
  resetKey: string;
}

/**
 * The Convex client prefixes a query's errors with its name, such as
 * `[CONVEX Q(cards:searchCardsPaginated)] ... Server Error`.
 */
export const isCardsReadError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("[CONVEX Q(cards:searchCardsPaginated)]");

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
