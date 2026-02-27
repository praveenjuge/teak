import { Host, ProgressView, Spacer, VStack } from "@expo/ui/swift-ui";

export default function LoadingScreen() {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" spacing={16}>
        <Spacer />
        <ProgressView />
        <Spacer />
      </VStack>
    </Host>
  );
}
