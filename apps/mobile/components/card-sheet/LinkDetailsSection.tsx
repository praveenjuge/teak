import { LabeledContent, Section, VStack } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { useWindowDimensions } from "react-native";
import { FullHeightMedia } from "@/components/card-preview/preview-sections";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";

const MAX_MEDIA = 4;
// The inset grouped list's horizontal margins and row padding.
const ROW_INSET = 72;

/**
 * What the web shows beside a link: the category facts (price, rating,
 * author…) and the photos or video stills attached to a post.
 */
function LinkDetailsSection({ card }: { card: CardSheetDetail }) {
  const { width } = useWindowDimensions();
  if (card.type !== "link") {
    return null;
  }
  const facts = card.metadata?.linkCategory?.facts ?? [];
  const media = (card.linkPreviewMedia ?? [])
    .map((item) => ({
      height: item.posterHeight ?? item.height,
      uri: item.type === "image" ? item.url : item.posterUrl,
      width: item.posterWidth ?? item.width,
    }))
    .filter((item): item is typeof item & { uri: string } => Boolean(item.uri))
    .slice(0, MAX_MEDIA);
  const rowWidth = width - ROW_INSET;

  return (
    <>
      {facts.length > 0 ? (
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Details"
        >
          {facts.map((fact) => (
            <LabeledContent
              key={fact.label}
              label={<SheetText>{fact.label}</SheetText>}
            >
              <SheetText secondary>{fact.value}</SheetText>
            </LabeledContent>
          ))}
        </Section>
      ) : null}
      {media.length > 1 ? (
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Media"
        >
          <VStack spacing={8}>
            {media.map((item) => (
              <FullHeightMedia
                fallbackIcon="photo"
                fallbackLabel="Media unavailable"
                height={
                  item.width && item.height
                    ? Math.min((rowWidth * item.height) / item.width, 520)
                    : rowWidth * 0.75
                }
                key={item.uri}
                primaryUri={item.uri}
              />
            ))}
          </VStack>
        </Section>
      ) : null}
    </>
  );
}

export { LinkDetailsSection };
