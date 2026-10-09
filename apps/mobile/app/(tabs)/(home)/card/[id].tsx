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
import { type ReactNode, useState } from "react";
import { CardPreviewSheet } from "@/components/CardPreviewSheet";
import { CardActionsToolbar } from "@/components/card-sheet/CardActionsToolbar";
import { getRememberedMobileCardSummary } from "@/lib/mobile-card-summary-cache";

export default function CardPreviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rememberedCard = getRememberedMobileCardSummary(id);
  const card = useQuery(api.cards.getCard, { id: id as Id<"cards"> });
  const [actionError, setActionError] = useState<string | null>(null);

  // Notes and quotes are their own content, so the sheet names the type.
  const cardType = card?.type ?? rememberedCard?.type;
  let sheetTitle =
    card?.metadataTitle ||
    card?.fileMetadata?.fileName ||
    rememberedCard?.title ||
    "Preview";
  if (cardType === "text") {
    sheetTitle = "Note";
  } else if (cardType === "quote") {
    sheetTitle = "Quote";
  }

  let cardContent: ReactNode;
  if (card === undefined) {
    cardContent = (
      <HStack alignment="center" spacing={0}>
        <Spacer />
        <ProgressView />
        <Spacer />
      </HStack>
    );
  } else if (card) {
    cardContent = (
      <CardPreviewSheet actionError={actionError} card={card} isOpen />
    );
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
      <Stack.Screen options={{ title: sheetTitle }} />
      {card ? (
        <CardActionsToolbar card={card} onError={setActionError} />
      ) : null}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {cardContent}
      </Host>
    </>
  );
}
