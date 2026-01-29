import { TagManagementModal } from "@/components/TagManagementModal";
import { MoreInformationModal } from "@/components/MoreInformationModal";
import { NotesEditModal } from "@/components/NotesEditModal";
import type { CardModalCard, GetCurrentValue } from "./types";

type CardModalOverlaysProps = {
  card: CardModalCard | null;
  showTagManagementModal: boolean;
  onTagManagementChange: (open: boolean) => void;
  showMoreInfoModal: boolean;
  onMoreInfoChange: (open: boolean) => void;
  showNotesEditModal: boolean;
  onNotesEditChange: (open: boolean) => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  removeAiTag: (tag: string) => void;
  getCurrentValue: GetCurrentValue;
  updateNotes: (notes: string) => void;
};

export function CardModalOverlays({
  card,
  showTagManagementModal,
  onTagManagementChange,
  showMoreInfoModal,
  onMoreInfoChange,
  showNotesEditModal,
  onNotesEditChange,
  tagInput,
  setTagInput,
  addTag,
  removeTag,
  removeAiTag,
  getCurrentValue,
  updateNotes,
}: CardModalOverlaysProps) {
  return (
    <>
      <TagManagementModal
        open={showTagManagementModal}
        onOpenChange={onTagManagementChange}
        userTags={card?.tags || []}
        aiTags={card?.aiTags || []}
        tagInput={tagInput}
        setTagInput={setTagInput}
        onAddTag={addTag}
        onRemoveTag={removeTag}
        onRemoveAiTag={removeAiTag}
      />

      <MoreInformationModal
        open={showMoreInfoModal}
        onOpenChange={onMoreInfoChange}
        card={card ?? null}
      />

      <NotesEditModal
        open={showNotesEditModal}
        onOpenChange={onNotesEditChange}
        notes={getCurrentValue("notes") || ""}
        onSave={(notes) => updateNotes(notes)}
        onCancel={() => {}}
      />
    </>
  );
}
