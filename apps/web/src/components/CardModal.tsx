import type { CardModalCard } from "@teak/ui/card-modal";
import { CardModal as SharedCardModal } from "@teak/ui/card-modal";
import {
  MoreInformationModal,
  NotesEditModal,
  TagManagementModal,
} from "@teak/ui/modals";
import { useState } from "react";
import { useCardModal } from "@/hooks/useCardModal";

interface CardModalProps {
  card?: CardModalCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
}

export function CardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onTagClick,
}: CardModalProps) {
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showMoreInfoModal, setShowMoreInfoModal] = useState(false);
  const [showNotesEditModal, setShowNotesEditModal] = useState(false);

  const {
    card,
    tagInput,
    setTagInput,
    updateContent,
    toggleFavorite,
    addTag,
    removeTag,
    removeAiTag,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    openLink,
    downloadFile,
    saveChanges,
    saveNotes,
    hasUnsavedChanges,
    getCurrentValue,
  } = useCardModal(cardId, { card: cardData, onCardTypeClick });

  return (
    <SharedCardModal
      card={card}
      downloadFile={downloadFile}
      getCurrentValue={getCurrentValue}
      handleDelete={handleDelete}
      handlePermanentDelete={handlePermanentDelete}
      handleRestore={handleRestore}
      hasUnsavedChanges={hasUnsavedChanges}
      MoreInformationModal={
        <MoreInformationModal
          card={card ?? null}
          onOpenChange={setShowMoreInfoModal}
          open={showMoreInfoModal}
        />
      }
      NotesEditModal={
        <NotesEditModal
          notes={getCurrentValue("notes") || ""}
          onCancel={() => {}}
          onOpenChange={setShowNotesEditModal}
          onSave={saveNotes}
          open={showNotesEditModal}
        />
      }
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onTagClick={onTagClick}
      open={open}
      openLink={openLink}
      saveChanges={saveChanges}
      setShowMoreInfoModal={setShowMoreInfoModal}
      setShowNotesEditModal={setShowNotesEditModal}
      setShowTagManagementModal={setShowTagManagementModal}
      showMoreInfoModal={showMoreInfoModal}
      showNotesEditModal={showNotesEditModal}
      showTagManagementModal={showTagManagementModal}
      TagManagementModal={
        <TagManagementModal
          aiTags={card?.aiTags || []}
          onAddTag={addTag}
          onOpenChange={setShowTagManagementModal}
          onRemoveAiTag={removeAiTag}
          onRemoveTag={removeTag}
          open={showTagManagementModal}
          setTagInput={setTagInput}
          tagInput={tagInput}
          userTags={card?.tags || []}
        />
      }
      toggleFavorite={toggleFavorite}
      updateContent={updateContent}
    />
  );
}
