import { Section } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { ChipRow } from "@/components/card-sheet/ChipRow";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";
import { useSearchForTag } from "@/lib/hooks/useSearchForTag";

function TagsNotesSection({ card }: { card: CardSheetDetail }) {
  const searchForTag = useSearchForTag();
  const tags = card.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
  const notes = card.notes?.trim();

  return (
    <>
      {notes ? (
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Notes"
        >
          <SheetText selectable>{notes}</SheetText>
        </Section>
      ) : null}
      {tags.length > 0 ? (
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Tags"
        >
          <ChipRow onPressTag={searchForTag} tags={tags} />
        </Section>
      ) : null}
    </>
  );
}

export { TagsNotesSection };
