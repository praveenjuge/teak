import {
  Button,
  ContentUnavailableView,
  Host,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, font } from "@expo/ui/swift-ui/modifiers";
import * as Network from "expo-network";
import { useCallback } from "react";

export default function OfflineScreen() {
  const handleRetry = useCallback(() => {
    void Network.getNetworkStateAsync();
  }, []);

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" spacing={16}>
        <Spacer />
        <ContentUnavailableView
          description="Check your connection and try again to access your cards."
          systemImage={"wifi.slash" as any}
          title="You're Offline"
        />
        <Button
          modifiers={[buttonStyle("bordered"), controlSize("large")]}
          onPress={handleRetry}
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
