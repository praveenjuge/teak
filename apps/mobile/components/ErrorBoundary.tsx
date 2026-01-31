import { Button, Host, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import React from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; retry: () => void }>;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error.message, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      return (
        <FallbackComponent error={this.state.error} retry={this.handleRetry} />
      );
    }

    return this.props.children;
  }
}

function DefaultErrorFallback({
  error,
  retry,
}: {
  error?: Error;
  retry: () => void;
}) {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" spacing={16}>
        <Spacer />
        <Text design="rounded" size={20} weight="semibold">
          Something went wrong
        </Text>
        <Text color="secondary" design="rounded" lineLimit={4} size={16}>
          {error?.message || "An unexpected error occurred"}
        </Text>
        <Button controlSize="large" onPress={retry} variant="bordered">
          <Text design="rounded" weight="medium">
            Try Again
          </Text>
        </Button>
        <Spacer />
      </VStack>
    </Host>
  );
}
