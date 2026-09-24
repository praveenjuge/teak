import { List, Section } from "@expo/ui/swift-ui";
import { listStyle } from "@expo/ui/swift-ui/modifiers";
import { ActionsSection } from "@/components/card-sheet/ActionsSection";
import { AiSummarySection } from "@/components/card-sheet/AiSummarySection";
import { InfoSection } from "@/components/card-sheet/InfoSection";
import { PreviewSection } from "@/components/card-sheet/PreviewSection";
import { TagsNotesSection } from "@/components/card-sheet/TagsNotesSection";
import type { CardSheetDetail } from "@/lib/card-sheet";

interface CardPreviewSheetProps {
  card: CardSheetDetail;
  isOpen: boolean;
}

function CardPreviewSheet({ card, isOpen }: CardPreviewSheetProps) {
  return (
    <List modifiers={[listStyle("insetGrouped")]}>
      <Section>
        <PreviewSection card={card} isOpen={isOpen} />
      </Section>
      <ActionsSection card={card} />
      <AiSummarySection card={card} />
      <TagsNotesSection card={card} />
      <InfoSection card={card} />
    </List>
  );
}

export { CardPreviewSheet };
