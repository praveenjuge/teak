"use client";

import { Component, type ReactNode } from "react";

interface RetryableQueryBoundaryProps {
  /** Whether this boundary handles an error; any other goes on up. */
  catches?: (error: unknown) => boolean;
  /** Renders the read, passing the retry key to add to its query args. */
  children: (retryKey: string | undefined) => ReactNode;
  fallback: (retry: () => void) => ReactNode;
  /** The retry key before any retry, such as an account's cache key. */
  initialKey?: string;
  onCatch?: (error: Error) => void;
  /** A new value clears a failure, as a retry does. */
  resetKey?: string;
}

interface RetryableQueryBoundaryState {
  error: unknown;
  failed: boolean;
  retryKey: string | undefined;
}

/**
 * Keeps a failed cached query read inside its part of the page, with a
 * retry. Each retry hands the read a new retry key to send as a query
 * argument: the cached query hooks keep a failed subscription alive, so
 * reading the same arguments again would only rethrow the cached error.
 */
export class RetryableQueryBoundary extends Component<
  RetryableQueryBoundaryProps,
  RetryableQueryBoundaryState
> {
  state: RetryableQueryBoundaryState = {
    error: null,
    failed: false,
    retryKey: undefined,
  };

  static getDerivedStateFromError(
    error: unknown
  ): Partial<RetryableQueryBoundaryState> {
    return { error, failed: true };
  }

  componentDidCatch(error: Error): void {
    if (this.handles(error)) {
      this.props.onCatch?.(error);
    }
  }

  componentDidUpdate(previous: RetryableQueryBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  handles(error: unknown): boolean {
    return this.props.catches?.(error) ?? true;
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
      return this.props.children(this.state.retryKey ?? this.props.initialKey);
    }
    if (!this.handles(this.state.error)) {
      throw this.state.error;
    }
    return this.props.fallback(this.retry);
  }
}
