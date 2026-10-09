import { Section } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { ChipRow } from "@/components/card-sheet/ChipRow";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";

function AiSummarySection({ card }: { card: CardSheetDetail }) {
  const summary = card.aiSummary?.trim();
  const tags = card.aiTags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
  const transcript = card.aiTranscript?.trim();
  // Palettes already show their colors as the preview.
  const colors =
    card.type === "palette"
      ? []
      : (card.colors?.slice(0, 8).map((color) => color.hex) ?? []);
  const hasChips = tags.length > 0 || colors.length > 0;

  return (
    <>
      {summary || hasChips ? (
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Summary"
        >
          {summary ? <SheetText selectable>{summary}</SheetText> : null}
          {hasChips ? <ChipRow colors={colors} sparkles tags={tags} /> : null}
        </Section>
      ) : null}
      {transcript ? (
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Transcript"
        >
          <SheetText selectable>{transcript}</SheetText>
        </Section>
      ) : null}
    </>
  );
}

export { AiSummarySection };
