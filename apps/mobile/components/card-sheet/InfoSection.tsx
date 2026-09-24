import { LabeledContent, Section } from "@expo/ui/swift-ui";
import { SheetText } from "@/components/card-sheet/SheetText";
import {
  type CardSheetDetail,
  formatSheetTimestamp,
  getSheetDetailRows,
} from "@/lib/card-sheet";

function InfoSection({ card }: { card: CardSheetDetail }) {
  const rows = getSheetDetailRows(card);

  return (
    <Section title="Info">
      {rows.map((row) => (
        <LabeledContent
          key={row.label}
          label={<SheetText>{row.label}</SheetText>}
        >
          <SheetText secondary>{row.value}</SheetText>
        </LabeledContent>
      ))}
      <LabeledContent label={<SheetText>Created</SheetText>}>
        <SheetText secondary>{formatSheetTimestamp(card.createdAt)}</SheetText>
      </LabeledContent>
      <LabeledContent label={<SheetText>Updated</SheetText>}>
        <SheetText secondary>{formatSheetTimestamp(card.updatedAt)}</SheetText>
      </LabeledContent>
    </Section>
  );
}

export { InfoSection };
