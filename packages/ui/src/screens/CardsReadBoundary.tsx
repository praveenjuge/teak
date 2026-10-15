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
  failed: boolean;
  retryKey: string | undefined;
}

/**
 * Keeps a failed card list read (a Convex query error thrown while the grid
 * renders) inside the library instead of replacing the whole app. Each reset
 * hands the screen a new retry key: the cached query hooks keep a failed
 * subscription alive, so reading the same arguments again would only rethrow
 * the cached error.
 */
export class CardsReadBoundary extends Component<
  CardsReadBoundaryProps,
  CardsReadBoundaryState
> {
  state: CardsReadBoundaryState = { failed: false, retryKey: undefined };

  static getDerivedStateFromError(): Partial<CardsReadBoundaryState> {
    return { failed: true };
  }

  // The error never reaches global-error now, so report it here.
  componentDidCatch(error: Error): void {
    captureClientException(error, { "ui.boundary": "cards" });
  }

  componentDidUpdate(previous: CardsReadBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  retry = (): void => {
    this.setState({ failed: false, retryKey: crypto.randomUUID() });
  };

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children(this.state.retryKey);
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
