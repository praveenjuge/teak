import React from "react";
import { Host, VStack, Text, Button, Spacer } from "@expo/ui/swift-ui";

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
    <Host useViewportSizeMeasurement style={{ flex: 1 }}>
      <VStack spacing={16} alignment="center">
        <Spacer />
        <Text weight="semibold" size={20} design="rounded">
          Something went wrong
        </Text>
        <Text color="secondary" size={16} lineLimit={4} design="rounded">
          {error?.message || "An unexpected error occurred"}
        </Text>
        <Button controlSize="large" variant="bordered" onPress={retry}>
          <Text weight="medium" design="rounded">
            Try Again
          </Text>
        </Button>
        <Spacer />
      </VStack>
    </Host>
  );
}
