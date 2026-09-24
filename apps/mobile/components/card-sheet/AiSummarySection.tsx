import { Section } from "@expo/ui/swift-ui";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";

function AiSummarySection({ card }: { card: CardSheetDetail }) {
  const summary = card.aiSummary?.trim();
  const tags = card.aiTags?.filter(Boolean) ?? [];
  const transcript = card.aiTranscript?.trim();

  if (!summary && tags.length === 0 && !transcript) {
    return null;
  }

  return (
    <Section title="Summary">
      {summary ? <SheetText selectable>{summary}</SheetText> : null}
      {tags.length > 0 ? (
        <SheetText secondary size={13}>
          {tags.join(" · ")}
        </SheetText>
      ) : null}
      {transcript ? (
        <SheetText secondary selectable>
          {transcript}
        </SheetText>
      ) : null}
    </Section>
  );
}

export { AiSummarySection };
