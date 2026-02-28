import { Button, Host, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import React from "react";

interface ErrorBoundaryState {
  error?: Error;
  hasError: boolean;
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
    <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" spacing={16}>
        <Spacer />
        <Text modifiers={[font({ design: "rounded", weight: "semibold" })]}>
          Something went wrong
        </Text>
        <Text
          modifiers={[
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
            font({ design: "rounded" }),
            lineLimit(4),
          ]}
        >
          {error?.message || "An unexpected error occurred"}
        </Text>
        <Button
          modifiers={[buttonStyle("bordered"), controlSize("large")]}
          onPress={retry}
        >
          <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
            Try Again
          </Text>
        </Button>
        <Spacer />
      </VStack>
    </Host>
  );
}
