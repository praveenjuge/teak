import { Section, VStack } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";

function TagsNotesSection({ card }: { card: CardSheetDetail }) {
  const tags = card.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
  const notes = card.notes?.trim();

  if (tags.length === 0 && !notes) {
    return null;
  }

  return (
    <Section
      modifiers={[font({ design: "rounded", weight: "medium" })]}
      title="Tags & Notes"
    >
      {tags.length > 0 ? (
        <VStack alignment="leading" spacing={2}>
          <SheetText secondary size={13}>
            Tags
          </SheetText>
          <SheetText>{tags.join(", ")}</SheetText>
        </VStack>
      ) : null}
      {notes ? <SheetText selectable>{notes}</SheetText> : null}
    </Section>
  );
}

export { TagsNotesSection };
