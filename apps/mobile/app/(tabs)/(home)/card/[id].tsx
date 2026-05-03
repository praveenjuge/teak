import {
  ContentUnavailableView,
  Host,
  HStack,
  ProgressView,
  Spacer,
} from "@expo/ui/swift-ui";
import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Stack, useLocalSearchParams } from "expo-router";
import { CardPreviewSheet } from "@/components/CardPreviewSheet";

export default function CardPreviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useQuery(api.cards.getCard, { id: id as Id<"cards"> });

  return (
    <>
      <Stack.Screen
        options={{
          title:
            card?.metadataTitle || card?.fileMetadata?.fileName || "Preview",
        }}
      />
      <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
        {card === undefined ? (
          <HStack alignment="center" spacing={0}>
            <Spacer />
            <ProgressView />
            <Spacer />
          </HStack>
        ) : card ? (
          <CardPreviewSheet card={card} isOpen />
        ) : (
          <ContentUnavailableView
            description="It may have been deleted or moved."
            systemImage="exclamationmark.triangle"
            title="Card unavailable"
          />
        )}
      </Host>
    </>
  );
}
