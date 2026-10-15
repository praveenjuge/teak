"use client";

import { captureClientException } from "@teak/convex/shared/client-telemetry";
import { Button } from "@teak/ui/components/ui/button";
import { Component, type ReactNode } from "react";

interface CardsReadBoundaryProps {
  children: (retryKey: string | undefined) => ReactNode;
  contentContainerClassName?: string;
  /** Shown above the message, such as the sidebar toggle. */
  headerLeading?: ReactNode;
  /** The view being read; a new view clears the failure. */
  resetKey: string;
}

interface CardsReadBoundaryState {
  error: unknown;
  failed: boolean;
  retryKey: string | undefined;
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
 * renders) inside the library instead of replacing the whole app. Each reset
 * hands the screen a new retry key: the cached query hooks keep a failed
 * subscription alive, so reading the same arguments again would only rethrow
 * the cached error. Only the card read gets that key, so any other error
 * (another query, a render bug) goes on to the app's own error screen.
 */
export class CardsReadBoundary extends Component<
  CardsReadBoundaryProps,
  CardsReadBoundaryState
> {
  state: CardsReadBoundaryState = {
    error: null,
    failed: false,
    retryKey: undefined,
  };

  static getDerivedStateFromError(
    error: unknown
  ): Partial<CardsReadBoundaryState> {
    return { error, failed: true };
  }

  // A card read failure never reaches global-error now, so report it here.
  componentDidCatch(error: Error): void {
    if (isCardsReadError(error)) {
      captureClientException(error, { "ui.boundary": "cards" });
    }
  }

  componentDidUpdate(previous: CardsReadBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  retry = (): void => {
    this.setState({
      error: null,
      failed: false,
      retryKey: crypto.randomUUID(),
    });
  };

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children(this.state.retryKey);
    }
    // A new retry key can't recover other errors; leave them to the app.
    if (!isCardsReadError(this.state.error)) {
      throw this.state.error;
    }
    const { contentContainerClassName, headerLeading } = this.props;
    const content = (
      <>
        {headerLeading ? (
          <div className="flex h-12 items-center">{headerLeading}</div>
        ) : null}
        <div className="space-y-4 py-12 text-center" role="alert">
          <p className="text-muted-foreground">Couldn't load your cards.</p>
          <Button onClick={this.retry} variant="outline">
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
  }
}
