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
import type { ReactNode } from "react";
import { CardPreviewSheet } from "@/components/CardPreviewSheet";
import { MobileCardSummaryPreview } from "@/components/MobileCardSummaryPreview";
import { getRememberedMobileCardSummary } from "@/lib/mobile-card-summary-cache";

export default function CardPreviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rememberedCard = getRememberedMobileCardSummary(id);
  const card = useQuery(api.cards.getCard, { id: id as Id<"cards"> });

  let cardContent: ReactNode;
  if (card === undefined && rememberedCard) {
    cardContent = <MobileCardSummaryPreview summary={rememberedCard} />;
  } else if (card === undefined) {
    cardContent = (
      <HStack alignment="center" spacing={0}>
        <Spacer />
        <ProgressView />
        <Spacer />
      </HStack>
    );
  } else if (card) {
    cardContent = <CardPreviewSheet card={card} isOpen />;
  } else {
    cardContent = (
      <ContentUnavailableView
        description="It may have been deleted or moved."
        systemImage="exclamationmark.triangle"
        title="Card unavailable"
      />
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title:
            card?.metadataTitle ||
            card?.fileMetadata?.fileName ||
            rememberedCard?.title ||
            "Preview",
        }}
      />
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {cardContent}
      </Host>
    </>
  );
}
