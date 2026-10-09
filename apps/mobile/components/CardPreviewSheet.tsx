import { List, Section } from "@expo/ui/swift-ui";
import { listStyle } from "@expo/ui/swift-ui/modifiers";
import { AiSummarySection } from "@/components/card-sheet/AiSummarySection";
import { InfoSection } from "@/components/card-sheet/InfoSection";
import { PreviewSection } from "@/components/card-sheet/PreviewSection";
import { SheetText } from "@/components/card-sheet/SheetText";
import { TagsNotesSection } from "@/components/card-sheet/TagsNotesSection";
import type { CardSheetDetail } from "@/lib/card-sheet";

interface CardPreviewSheetProps {
  /** A failed toolbar action, shown under the preview. */
  actionError?: string | null;
  card: CardSheetDetail;
  isOpen: boolean;
}

function CardPreviewSheet({
  actionError,
  card,
  isOpen,
}: CardPreviewSheetProps) {
  return (
    <List modifiers={[listStyle("insetGrouped")]}>
      <Section>
        <PreviewSection card={card} isOpen={isOpen} />
      </Section>
      {actionError ? (
        <Section>
          <SheetText destructive>{actionError}</SheetText>
        </Section>
      ) : null}
      <TagsNotesSection card={card} />
      <AiSummarySection card={card} />
      <InfoSection card={card} />
    </List>
  );
}

export { CardPreviewSheet };
