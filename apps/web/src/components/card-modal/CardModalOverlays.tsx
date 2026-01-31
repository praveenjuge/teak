import { MoreInformationModal } from "@/components/MoreInformationModal";
import { NotesEditModal } from "@/components/NotesEditModal";
import { TagManagementModal } from "@/components/TagManagementModal";
import type { CardModalCard, GetCurrentValue } from "./types";

interface CardModalOverlaysProps {
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
}

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
        aiTags={card?.aiTags || []}
        onAddTag={addTag}
        onOpenChange={onTagManagementChange}
        onRemoveAiTag={removeAiTag}
        onRemoveTag={removeTag}
        open={showTagManagementModal}
        setTagInput={setTagInput}
        tagInput={tagInput}
        userTags={card?.tags || []}
      />

      <MoreInformationModal
        card={card ?? null}
        onOpenChange={onMoreInfoChange}
        open={showMoreInfoModal}
      />

      <NotesEditModal
        notes={getCurrentValue("notes") || ""}
        onCancel={() => {
          // No-op: modal handles its own cancel behavior
        }}
        onOpenChange={onNotesEditChange}
        onSave={(notes) => updateNotes(notes)}
        open={showNotesEditModal}
      />
    </>
  );
}
