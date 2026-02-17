import { MoreInformationModal } from "@/components/MoreInformationModal";
import { NotesEditModal } from "@/components/NotesEditModal";
import { TagManagementModal } from "@/components/TagManagementModal";
import type { CardModalCard, GetCurrentValue } from "./types";

interface CardModalOverlaysProps {
  addTag: () => void;
  card: CardModalCard | null;
  getCurrentValue: GetCurrentValue;
  onMoreInfoChange: (open: boolean) => void;
  onNotesEditChange: (open: boolean) => void;
  onTagManagementChange: (open: boolean) => void;
  removeAiTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  saveNotes: (notes: string) => Promise<boolean>;
  setTagInput: (value: string) => void;
  showMoreInfoModal: boolean;
  showNotesEditModal: boolean;
  showTagManagementModal: boolean;
  tagInput: string;
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
  saveNotes,
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
        onSave={saveNotes}
        open={showNotesEditModal}
      />
    </>
  );
}
