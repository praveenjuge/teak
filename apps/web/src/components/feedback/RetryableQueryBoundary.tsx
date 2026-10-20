"use client";

import { Component, type ReactNode } from "react";

interface RetryableQueryBoundaryProps {
  catches?: (error: unknown) => boolean;
  children: (retryKey: string | undefined) => ReactNode;
  fallback: (retry: () => void) => ReactNode;
  initialKey?: string;
  onCatch?: (error: Error) => void;
  resetKey?: string;
}

interface RetryableQueryBoundaryState {
  error: unknown;
  failed: boolean;
  retryKey: string | undefined;
}

/**
 * The cached query hooks keep a failed subscription alive, so reading the
 * same arguments again would only rethrow the cached error: each retry hands
 * the read a new retry key to send as a query argument.
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
